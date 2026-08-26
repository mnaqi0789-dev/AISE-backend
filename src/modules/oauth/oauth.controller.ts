import { Request, Response } from "express";
import crypto from "crypto";
import {
  buildAuthUrl,
  exchangeCodeAndVerify,
} from "./providers/google.provider";
import { userRepository } from "../../db/repo/user.repository";
import { issueSession } from "../tokens/session.service";
import { asyncHandler } from "../../middleware/asyncHandler";
import { logEvent } from "../../core/audit/auditLogger";
import { AuthenticatedRequest } from "../../middleware/requireAuth";
import prisma from "../../db/prisma";
import env from "../../config/env";

const STATE_TTL_MS = 10 * 60 * 1000;

function redirectWithError(res: Response, target: string, message: string) {
  res.redirect(
    `${env.FRONTEND_URL}${target}?oauthError=${encodeURIComponent(message)}`,
  );
}

export const googleRedirect = asyncHandler(
  async (_req: Request, res: Response) => {
    const state = crypto.randomBytes(16).toString("hex");
    await prisma.oAuthState.create({
      data: { state, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    res.redirect(buildAuthUrl(state));
  },
);

export const googleLinkRedirect = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const state = crypto.randomBytes(16).toString("hex");
    await prisma.oAuthState.create({
      data: {
        state,
        linkUserId: req.user!.userId,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });
    res.redirect(buildAuthUrl(state));
  },
);

export const googleStatus = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const link = await prisma.oAuthAccount.findFirst({
      where: { userId: req.user!.userId, provider: "google" },
    });
    res.status(200).json({
      linked: !!link,
      email: link?.email ?? null,
    });
  },
);

export const googleCallback = asyncHandler(
  async (req: Request, res: Response) => {
    const { code, state } = req.query;

    if (typeof state !== "string") {
      return redirectWithError(
        res,
        "/login",
        "Invalid or missing state parameter",
      );
    }

    const entry = await prisma.oAuthState.findUnique({ where: { state } });

    if (!entry) {
      return redirectWithError(
        res,
        "/login",
        "Invalid or missing state parameter",
      );
    }

    await prisma.oAuthState.delete({ where: { state } });

    if (Date.now() > entry.expiresAt.getTime()) {
      return redirectWithError(
        res,
        entry.linkUserId ? "/dashboard" : "/login",
        "This Google sign-in link expired, please try again",
      );
    }

    if (typeof code !== "string") {
      return redirectWithError(
        res,
        entry.linkUserId ? "/dashboard" : "/login",
        "Missing authorization code from Google",
      );
    }

    const profile = await exchangeCodeAndVerify(code);

    if (entry.linkUserId) {
      const existingLink = await prisma.oAuthAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: "google",
            providerUserId: profile.sub,
          },
        },
      });

      if (existingLink && existingLink.userId !== entry.linkUserId) {
        return redirectWithError(
          res,
          "/dashboard",
          "This Google account is already linked to a different user",
        );
      }

      if (!existingLink) {
        await prisma.oAuthAccount.create({
          data: {
            userId: entry.linkUserId,
            provider: "google",
            providerUserId: profile.sub,
            email: profile.email,
          },
        });
        await logEvent("oauth_login", entry.linkUserId, req.ip ?? null, {
          provider: "google",
          linked: true,
        });
      }

      res.redirect(`${env.FRONTEND_URL}/dashboard?linked=google`);
      return;
    }

    const existingOAuthAccount = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: "google",
          providerUserId: profile.sub,
        },
      },
    });

    let userId: string;
    let wasSignup = false;

    if (existingOAuthAccount) {
      const linkedUser = await userRepository.findById(
        existingOAuthAccount.userId,
      );
      if (!linkedUser) {
        return redirectWithError(
          res,
          "/login",
          "Linked account no longer exists",
        );
      }
      userId = linkedUser.id;
    } else {
      const existingUser = await userRepository.findByEmail(profile.email);

      if (existingUser && profile.emailVerified) {
        await prisma.oAuthAccount.create({
          data: {
            userId: existingUser.id,
            provider: "google",
            providerUserId: profile.sub,
            email: profile.email,
          },
        });
        userId = existingUser.id;
      } else if (existingUser && !profile.emailVerified) {
        return redirectWithError(
          res,
          "/login",
          "Email exists but is not verified with Google, cannot auto-link",
        );
      } else {
        const newUser = await userRepository.create({
          email: profile.email,
          passwordHash: null,
        });
        await prisma.oAuthAccount.create({
          data: {
            userId: newUser.id,
            provider: "google",
            providerUserId: profile.sub,
            email: profile.email,
          },
        });
        userId = newUser.id;
        wasSignup = true;
      }
    }

    await logEvent(
      wasSignup ? "oauth_signup" : "oauth_login",
      userId,
      req.ip ?? null,
      { provider: "google" },
    );

    const { refreshToken } = await issueSession(userId, req);
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  },
);
