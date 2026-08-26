import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import {
  listUsers,
  getUserById,
  listAuditEvents,
  updateUserRole,
  unlockUser,
  listAllSessions,
  getConfig,
  adminRevokeSession,
} from "../modules/admin/admin.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/users", listUsers);
router.get("/users/:id", getUserById);
router.get("/audit-events", listAuditEvents);
router.patch("/users/:id/role", updateUserRole);
router.patch("/users/:id/unlock", unlockUser);
router.get("/sessions", listAllSessions);
router.get("/config", getConfig);
router.delete("/sessions/:id", adminRevokeSession);

export default router;
