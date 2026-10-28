// PostgREST caps every response at max-rows (1000 on this project) whatever
// .limit() asks for, so an analytics read that can grow past that pages
// through with .range(). A postgrest builder re-fetches on every await and
// .range() overwrites offset/limit, so one builder serves every page. The
// builder MUST be totally ordered (end on a unique column) or pages overlap.

type PageResult<T> = { data: T[] | null; error: { message: string; code?: string; hint?: string } | null };
interface Rangeable<T> { range(from: number, to: number): PromiseLike<PageResult<T>> }

const PAGE = 1000;

export async function fetchAll<T = any>(q: Rangeable<T>, max = 200_000): Promise<PageResult<T> & { data: T[] }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { data: rows, error: null };
}
