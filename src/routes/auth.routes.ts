import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { validate } from "../middlewares/validate";
import { authRateLimiter } from "../middlewares/authRateLimiter";
import { loginSchema, refreshTokenBodySchema, registerSchema, verifyEmailQuerySchema } from "../validators/auth.validators";
import { login, logout, refreshTokenHandler, register, verifyEmail } from "../controllers/auth.controller";

export const authRouter = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Registrar un nuevo usuario
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, username, password, confirmPassword]
 *             properties:
 *               email: { type: string, format: email }
 *               username: { type: string }
 *               password: { type: string, format: password }
 *               confirmPassword: { type: string, format: password }
 *     responses:
 *       201:
 *         description: Usuario creado. Setea cookies HttpOnly accessToken/refreshToken.
 *       409:
 *         description: Email o username ya existen
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
authRouter.post("/register", authRateLimiter, validate(registerSchema), asyncHandler(register));

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Iniciar sesión
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Sesión iniciada. Setea cookies HttpOnly accessToken/refreshToken.
 *       401:
 *         description: Credenciales inválidas
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
authRouter.post("/login", authRateLimiter, validate(loginSchema), asyncHandler(login));

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Cerrar sesión (revoca el refresh token y limpia las cookies)
 *     tags: [Autenticación]
 *     responses:
 *       200:
 *         description: Sesión cerrada
 */
authRouter.post("/logout", asyncHandler(logout));

/**
 * @openapi
 * /auth/refresh-token:
 *   post:
 *     summary: Renovar el accessToken usando el refreshToken (cookie o body)
 *     tags: [Autenticación]
 *     responses:
 *       200:
 *         description: Nuevo accessToken emitido (y refreshToken rotado)
 *       401:
 *         description: Refresh token inválido o expirado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
authRouter.post(
  "/refresh-token",
  authRateLimiter,
  validate(refreshTokenBodySchema),
  asyncHandler(refreshTokenHandler)
);

/**
 * @openapi
 * /auth/verify-email:
 *   get:
 *     summary: Verificar el email con el token enviado al registrarse
 *     tags: [Autenticación]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Email verificado
 *       400:
 *         description: Token inválido o expirado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
authRouter.get("/verify-email", validate(verifyEmailQuerySchema, "query"), asyncHandler(verifyEmail));
