import { describe, it, expect, beforeEach } from "vitest";
import { backoffFor, getDataHealth, markFailed, markOk, requestResync, resetDataHealth, RESYNC_THROTTLE_MS, setGaveUp, setRealtime } from "./data-health";
import { loadAllPages, nextCollectionState, PAGE_SIZE, type FetchPage } from "./collection-fetch";

beforeEach(() => resetDataHealth());

describe("data-health", () => {
    it("marca y limpia colecciones fallidas sin duplicar", () => {
        markFailed("materials"); markFailed("materials"); markFailed("profiles");
        expect(getDataHealth().failed).toEqual(["materials", "profiles"]);
        markOk("materials");
        expect(getDataHealth().failed).toEqual(["profiles"]);
    });

    it("rastrea Realtime caído por tabla", () => {
        setRealtime("a", false); setRealtime("b", false); setRealtime("a", true);
        expect(getDataHealth().realtimeDown).toEqual(["b"]);
    });

    it("limita las resincronizaciones automáticas pero no el reintento manual", () => {
        expect(requestResync(false, 1_000_000)).toBe(true);
        expect(requestResync(false, 1_000_000 + RESYNC_THROTTLE_MS - 1)).toBe(false);
        expect(getDataHealth().retryTick).toBe(1);
        expect(requestResync(true, 1_000_000 + 10)).toBe(true);
        expect(getDataHealth().retryTick).toBe(2);
        expect(requestResync(false, 1_000_000 + 10 + RESYNC_THROTTLE_MS)).toBe(true);
    });

    it("el reintento manual levanta el «me di por vencido»", () => {
        setGaveUp(true);
        requestResync(true);
        expect(getDataHealth().gaveUp).toBe(false);
    });

    it("el backoff se agota", () => {
        expect(backoffFor(0)).toBe(3000);
        expect(backoffFor(4)).toBeNull();
    });
});

const rows = (n: number, off = 0) => Array.from({ length: n }, (_, i) => ({ id: off + i }));

describe("loadAllPages", () => {
    it("pagina hasta una página incompleta", async () => {
        const pages = [rows(PAGE_SIZE), rows(PAGE_SIZE, PAGE_SIZE), rows(5, 2 * PAGE_SIZE)];
        let i = 0;
        const f: FetchPage = async () => ({ data: pages[i++], error: null });
        const r = await loadAllPages(f, { columns: "*" });
        expect(r.ok && r.rows.length).toBe(2 * PAGE_SIZE + 5);
    });

    it("un fallo a mitad NO devuelve filas parciales", async () => {
        let i = 0;
        const f: FetchPage = async () => (i++ === 0 ? { data: rows(PAGE_SIZE), error: null } : { data: null, error: { message: "boom" } });
        const r = await loadAllPages(f, { columns: "*" });
        expect(r).toEqual({ ok: false, error: "boom" });
    });

    it("usa fallbackColumns ante 42703", async () => {
        const seen: string[] = [];
        const f: FetchPage = async (_a, _b, cols) => {
            seen.push(cols);
            return cols === "a,b" ? { data: null, error: { code: "42703", message: "no col" } } : { data: rows(2), error: null };
        };
        const r = await loadAllPages(f, { columns: "a,b", fallbackColumns: "a" });
        expect(seen).toEqual(["a,b", "a"]);
        expect(r.ok).toBe(true);
    });

    it("una petición colgada vence por tiempo", async () => {
        const f: FetchPage = (_a, _b, _c, signal) =>
            new Promise((_res, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))));
        const r = await loadAllPages(f, { columns: "*", timeoutMs: 20 });
        expect(r).toEqual({ ok: false, error: "tiempo de espera agotado" });
    });
});

describe("nextCollectionState", () => {
    it("una carga fallida conserva los datos buenos", () => {
        expect(nextCollectionState([1, 2], { ok: false, error: "x" })).toEqual({ data: [1, 2], failed: true });
    });
    it("una carga buena reemplaza y mapea", () => {
        expect(nextCollectionState([9], { ok: true, rows: [{ n: 1 }] }, r => r.n)).toEqual({ data: [1], failed: false });
    });
});
