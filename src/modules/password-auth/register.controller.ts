import { Request, Response } from "express";
import { registerSchema } from "./validators";
import { hashPassword } from "./password.service";
import { userRepository } from "../../db/repo/user.repository";
import { ConflictError, ValidationError } from "../../core/errors/AppError";
import { asyncHandler } from "../../middleware/asyncHandler";
import { eventBus } from "../../core/events/eventBus";

export const register = asyncHandler(async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid input",
    );
  }

  const { email, password } = parsed.data;

  const existing = await userRepository.findByEmail(email);
  if (existing) {
    throw new ConflictError("Email already registered");
  }

  const passwordHash = await hashPassword(password);
  const user = await userRepository.create({ email, passwordHash });

  eventBus.emit("user.registered", { userId: user.id });

  res.status(201).json({
    id: user.id,
    email: user.email,
    role: user.role,
  });
});
