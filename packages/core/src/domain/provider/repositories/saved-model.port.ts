import type { SavedModel } from "../model/saved-model.js";

export interface SavedModelRepository {
  listByProvider(providerId: string): Promise<SavedModel[]>;
  findById(id: string): Promise<SavedModel | null>;
  insert(model: SavedModel): Promise<void>;
  updateById(model: SavedModel): Promise<void>;
  deleteById(id: string): Promise<boolean>;
  deleteByProvider(providerId: string): Promise<void>;
}
