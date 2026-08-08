import { Router } from "express";
import { animeRouter } from "./anime.routes";

export const apiV1Router = Router();

apiV1Router.use("/anime", animeRouter);
