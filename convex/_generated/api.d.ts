/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as ai from "../ai.js";
import type * as aiConfig from "../aiConfig.js";
import type * as fixPhotos from "../fixPhotos.js";
import type * as http from "../http.js";
import type * as letters from "../letters.js";
import type * as openai from "../openai.js";
import type * as photos from "../photos.js";
import type * as properties from "../properties.js";
import type * as resend from "../resend.js";
import type * as streets from "../streets.js";
import type * as templates from "../templates.js";
import type * as violations from "../violations.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  aiConfig: typeof aiConfig;
  fixPhotos: typeof fixPhotos;
  http: typeof http;
  letters: typeof letters;
  openai: typeof openai;
  photos: typeof photos;
  properties: typeof properties;
  resend: typeof resend;
  streets: typeof streets;
  templates: typeof templates;
  violations: typeof violations;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
