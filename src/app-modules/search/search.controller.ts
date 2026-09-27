import { Request, Response } from "express";
import { searchDocuments } from "../indexing/search";
import { resolveLens } from "./lensResolver";

export async function search(req: Request, res: Response) {
  const query = (req.query.q as string)?.trim();
  const lensParam = req.query.lens as string | undefined;
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const perPage = Math.min(
    50,
    Math.max(1, parseInt((req.query.per_page as string) || "20", 10)),
  );

  if (!query) {
    return res.status(400).json({ message: "Query parameter 'q' is required" });
  }

  const resolvedLens = await resolveLens(lensParam);

  const results = await searchDocuments(query, {
    domains: resolvedLens.domains ?? undefined,
    limit: perPage,
    offset: (page - 1) * perPage,
  });

  res.status(200).json({
    query,
    lens: resolvedLens.lensName,
    lens_mode: resolvedLens.lensMode,
    raw_results: results,
    synthesized_answer: null,
    pagination: {
      page,
      per_page: perPage,
      approx_total:
        results.length === perPage
          ? `${page * perPage}+`
          : `${(page - 1) * perPage + results.length}`,
    },
    source: "index",
  });
}
