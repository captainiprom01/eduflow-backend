const { z } = require('zod');

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function parsePagination(query) {
  const parsed = paginationSchema.parse(query);
  return {
    ...parsed,
    offset: (parsed.page - 1) * parsed.pageSize,
  };
}

function paginationMeta(page, pageSize, total) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

module.exports = { parsePagination, paginationMeta };
