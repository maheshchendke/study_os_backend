import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { entityController } from "../controllers/entities.js";

export function entityRoutes(resource, options = () => ({})) {
  const router = Router();
  const controller = entityController(resource, options);
  router.get("/", asyncHandler(controller.list));
  router.get("/:id", asyncHandler(controller.get));
  router.post("/", asyncHandler(controller.create));
  router.put("/:id", asyncHandler(controller.update));
  router.delete("/:id", asyncHandler(controller.remove));
  return router;
}
