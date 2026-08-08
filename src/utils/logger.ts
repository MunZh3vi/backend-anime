import winston from "winston";
import { env, isProd } from "../config/env";

export const logger = winston.createLogger({
  level: env.logLevel,
  format: isProd
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `[${timestamp}] ${level}: ${message}${rest}`;
        })
      ),
  transports: [new winston.transports.Console()],
});
