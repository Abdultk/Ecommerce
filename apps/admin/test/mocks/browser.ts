import { setupWorker } from "msw/browser";
import { API_URL } from "@/lib/config";
import { createAdminMockHandlers } from "./handlers";

/** Started by MockProvider only when NEXT_PUBLIC_API_MOCKING=enabled. */
export const worker = setupWorker(...createAdminMockHandlers(API_URL));
