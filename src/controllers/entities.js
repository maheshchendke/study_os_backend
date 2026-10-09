import { ApiError, objectBody, sendSuccess } from "../utils/http.js";
import { createEntity, deleteEntity, getEntity, listEntities, updateEntity } from "../services/entities.js";

export function entityController(resource, options = () => ({})) {
  return {
    list: async (req, res) => sendSuccess(res, await listEntities(resource, req.user.id, options(req))),
    get: async (req, res) => sendSuccess(res, await getEntity(resource, req.user.id, req.params.id, options(req))),
    create: async (req, res) => sendSuccess(res, await createEntity(resource, req.user.id, objectBody(req.body), options(req)), "Record created."),
    update: async (req, res) => sendSuccess(res, await updateEntity(resource, req.user.id, req.params.id, objectBody(req.body), options(req)), "Record updated."),
    remove: async (req, res) => {
      await deleteEntity(resource, req.user.id, req.params.id, options(req));
      res.json({ success: true, data: null, message: "Record deleted." });
    },
  };
}

export function resourceConfig(resource) {
  if (!resource) throw new ApiError(404, "Resource not found.", "NOT_FOUND");
  return resource;
}
