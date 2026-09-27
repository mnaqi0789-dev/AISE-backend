import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { search } from "../app-modules/search/search.controller";

const router = Router();

router.get("/", asyncHandler(search));

export default router;
