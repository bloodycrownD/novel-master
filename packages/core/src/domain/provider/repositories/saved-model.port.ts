import type { SavedModel } from "../model/saved-model.js";

export interface SavedModelRepository {
  listByProvider(providerId: string): Promise<SavedModel[]>;
  find(providerId: string, vendorModelId: string): Promise<SavedModel | null>;
  insert(model: SavedModel): Promise<void>;
  update(model: SavedModel): Promise<void>;
  delete(providerId: string, vendorModelId: string): Promise<boolean>;
  deleteByProvider(providerId: string): Promise<void>;
}
