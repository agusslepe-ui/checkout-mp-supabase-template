import { CART_KEY, cartStore } from "./cartStore.js";
import "./checkoutAttemptClient.js";

const checkoutAttemptClient = globalThis.LemontCheckoutAttempt;

export function cleanupSuccessState({
  localStorageApi = globalThis.localStorage,
  sessionStorageApi = globalThis.sessionStorage,
  cartStoreApi = cartStore,
  attemptClient = checkoutAttemptClient,
} = {}) {
  try {
    cartStoreApi?.clear();
  } catch {
    // Continue with direct removal if the store cannot notify its subscribers.
  }

  try {
    localStorageApi?.removeItem(CART_KEY);
  } catch {
    // Storage may be disabled. Continue so the attempt can still be cleared.
  }

  try {
    attemptClient?.clearCheckoutAttempt(sessionStorageApi);
  } catch {
    // A storage failure must not break the success page.
  }
}

cleanupSuccessState();
