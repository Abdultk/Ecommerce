import { AuthSession, Cart } from "@hp/contracts";
import { createApiClient } from "@hp/api-client";
import { authStore } from "@/lib/auth-store";
import { API_URL } from "./server";

const api = createApiClient(API_URL);

/** Signs in through the mock API so its session and the in-memory token agree. */
export async function signInMock(email = "ada@example.test"): Promise<AuthSession> {
  const { data } = await api.post("/auth/login", { email, password: "correct horse" }, AuthSession);
  authStore.setSession(data);
  return data;
}

export function signOutLocal(): void {
  authStore.clear();
}

/** Puts a line in the shared mock cart. */
export async function addToMockCart(variantId = "v_sample_01_1", quantity = 1): Promise<Cart> {
  return (await api.post("/cart/items", { variantId, quantity }, Cart)).data;
}
