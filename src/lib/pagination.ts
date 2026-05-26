export function parsePagination(page?: string, limit?: string) {
  const pageNum = Math.max(1, parseInt(page || "1"));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit || "20")));
  return { page: pageNum, limit: limitNum, offset: (pageNum - 1) * limitNum };
}

// Alias with explicit pageNum/limitNum keys for destructuring clarity
export function paginate(page?: string, limit?: string) {
  const pageNum = Math.max(1, parseInt(page || "1"));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit || "20")));
  return { pageNum, limitNum, offset: (pageNum - 1) * limitNum };
}
