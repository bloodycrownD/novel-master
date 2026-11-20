import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { SavedModel } from "../model/saved-model.js";

export interface SavedModelRepository {
  listByProvider(providerId: string): Promise<Result<SavedModel[], AppError>>;
  findById(id: string): Promise<Result<SavedModel | null, AppError>>;
  insert(model: SavedModel): Promise<void>;
  updateById(model: SavedModel): Promise<void>;
  deleteById(id: string): Promise<boolean>;
  deleteByProvider(providerId: string): Promise<void>;
}
