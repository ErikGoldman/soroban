export interface SavedCalculation {
  userId: string;
  email: string;
  amount: number;
  years: number;
  finalValue: number;
  updatedAt: string;
}

export interface PlanningStorage {
  getLatestCalculation(userId: string): Promise<SavedCalculation | null>;
  saveCalculation(record: Omit<SavedCalculation, "updatedAt">): Promise<SavedCalculation>;
}

const DB_NAME = "soroban-financial-planner";
const DB_VERSION = 1;
const STORE_NAME = "calculations";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "userId" });
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  callback: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (error?: unknown) => void
  ) => void
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let settled = false;

        const finishResolve = (value: T) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        };

        const finishReject = (error?: unknown) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        };

        transaction.addEventListener("complete", () => {
          database.close();
        });
        transaction.addEventListener("error", () => {
          database.close();
          finishReject(transaction.error);
        });
        transaction.addEventListener("abort", () => {
          database.close();
          finishReject(transaction.error || new Error("IndexedDB transaction aborted"));
        });

        callback(store, finishResolve, finishReject);
      })
  );
}

export class IndexedDbPlanningStorage implements PlanningStorage {
  async getLatestCalculation(userId: string): Promise<SavedCalculation | null> {
    return withStore<SavedCalculation | null>("readonly", (store, resolve, reject) => {
      const request = store.get(userId);

      request.addEventListener("success", () => {
        resolve((request.result as SavedCalculation | undefined) || null);
      });
      request.addEventListener("error", () => {
        reject(request.error);
      });
    });
  }

  async saveCalculation({
    userId,
    email,
    amount,
    years,
    finalValue,
  }: Omit<SavedCalculation, "updatedAt">): Promise<SavedCalculation> {
    const record: SavedCalculation = {
      userId,
      email,
      amount,
      years,
      finalValue,
      updatedAt: new Date().toISOString(),
    };

    await withStore<void>("readwrite", (store, resolve, reject) => {
      const request = store.put(record);

      request.addEventListener("success", () => {
        resolve();
      });
      request.addEventListener("error", () => {
        reject(request.error);
      });
    });

    return record;
  }
}

export function createPlanningStorage(): PlanningStorage {
  return new IndexedDbPlanningStorage();
}
