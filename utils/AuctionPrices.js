import { chat } from './Chat';
import { DataComponents } from './Constants';
import { Promise } from './Promise';
import requestV2 from './Request';
import { v5Command } from './V5Commands';

// The Hypixel API can't filter auctions, so a per-item lookup would mean downloading every page.
const LOWEST_BIN_URL = 'https://sky.coflnet.com/api/item/price/';
const CACHE_MS = 60_000;

const cache = new Map();
const inFlight = new Map();

const normalizeId = (itemId) =>
    String(itemId || '')
        .trim()
        .toUpperCase();

export function getSkyblockItemId(item) {
    if (!item) return null;
    let data = '';
    try {
        data = String(item.toMC?.()?.get?.(DataComponents.CUSTOM_DATA)?.copyTag?.() || '');
    } catch (e) {}
    if (!data) data = String(item.getNBT?.() || '');
    return data.match(/\bid\s*[:=]\s*"?([^",}\s]+)/i)?.[1] || null;
}

/**
 * Lowest BIN for a SkyBlock item ID (e.g. "TREECAPITATOR_AXE").
 * Resolves { lowest, secondLowest, auctionId }, or null when the item has no BIN listings.
 */
export function getLowestBin(itemId, maxAgeMs = CACHE_MS) {
    const id = normalizeId(itemId);
    if (!id) return Promise.resolve(null);

    const cached = cache.get(id);
    if (cached && Date.now() - cached.at < maxAgeMs) return Promise.resolve(cached.price);
    if (inFlight.has(id)) return inFlight.get(id);

    const store = (price) => {
        cache.set(id, { price, at: Date.now() });
        inFlight.delete(id);
        return price;
    };

    const request = requestV2({ url: LOWEST_BIN_URL + encodeURIComponent(id) + '/bin', method: 'GET', json: true, timeout: 10_000 }).then(
        (body) =>
            store(
                body?.lowest > 0
                    ? {
                          lowest: body.lowest,
                          secondLowest: body.secondLowest > 0 ? body.secondLowest : null,
                          auctionId: body.uuid || null,
                      }
                    : null
            ),
        (error) => {
            if (error?.slug === 'item_not_found') return store(null);
            inFlight.delete(id);
            throw error;
        }
    );

    inFlight.set(id, request);
    return request;
}

export const getCachedLowestBin = (itemId) => cache.get(normalizeId(itemId))?.price ?? null;

export const formatCoins = (coins) =>
    Math.round(coins)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

v5Command(
    'lowestbin',
    (...args) => {
        const id = normalizeId(args.length ? args.join('_') : getSkyblockItemId(Player.getHeldItem()));
        if (!id) return chat('&cUsage: &7/v5 lowestbin <ITEM_ID> &c(or hold the item)');

        getLowestBin(id)
            .then((price) => {
                if (!price) return chat('&cNo BIN listings for &f' + id);
                const second = price.secondLowest ? '&7 (next: &6' + formatCoins(price.secondLowest) + '&7)' : '';
                chat('&f' + id + '&7 lowest BIN: &6' + formatCoins(price.lowest) + ' coins' + second);
            })
            .catch((error) => {
                chat('&cCould not fetch the price for &f' + id);
                console.error('AuctionPrices: lowest BIN request failed for ' + id, error);
            });
    },
    ['greedyString']
);
