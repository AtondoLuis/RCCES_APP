type ReadResult<T> = { data: T[] | null; error: { message: string } | null };

export async function readAll<T>(
  readPage: (from: number, to: number) => Promise<ReadResult<T>>,
): Promise<ReadResult<T>> {
  const data: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await readPage(from, from + 999);
    if (page.error) return { data: null, error: page.error };
    const rows = page.data ?? [];
    data.push(...rows);
    if (rows.length < 1000) return { data, error: null };
  }
}
