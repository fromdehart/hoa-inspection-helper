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
import type * as aiConfig from "../aiConfig.js";
import type * as arcApplicationReview from "../arcApplicationReview.js";
import type * as arcApplications from "../arcApplications.js";
import type * as arcDocIngest from "../arcDocIngest.js";
import type * as arcReferenceDocs from "../arcReferenceDocs.js";
import type * as arcReviewSettings from "../arcReviewSettings.js";
import type * as chat from "../chat.js";
import type * as demoSeed from "../demoSeed.js";
import type * as fixPhotos from "../fixPhotos.js";
import type * as homeowners from "../homeowners.js";
import type * as http from "../http.js";
import type * as inspectionBullets from "../inspectionBullets.js";
import type * as letterBody from "../letterBody.js";
import type * as letterTemplateDocs from "../letterTemplateDocs.js";
import type * as letterTemplateIngest from "../letterTemplateIngest.js";
import type * as letters from "../letters.js";
import type * as lib_arcReviewJson from "../lib/arcReviewJson.js";
import type * as lib_homeownerAuth from "../lib/homeownerAuth.js";
import type * as lib_homeownerRateLimit from "../lib/homeownerRateLimit.js";
import type * as lib_inspectorNotes from "../lib/inspectorNotes.js";
import type * as lib_letterBulletFewShot from "../lib/letterBulletFewShot.js";
import type * as lib_letterTemplateVariant from "../lib/letterTemplateVariant.js";
import type * as lib_letterTemplateVersions from "../lib/letterTemplateVersions.js";
import type * as lib_letterWorkflow from "../lib/letterWorkflow.js";
import type * as lib_parseDocxText from "../lib/parseDocxText.js";
import type * as lib_platformAuth from "../lib/platformAuth.js";
import type * as lib_propertyStatus from "../lib/propertyStatus.js";
import type * as lib_tenantAuth from "../lib/tenantAuth.js";
import type * as members from "../members.js";
import type * as membersNode from "../membersNode.js";
import type * as multiHoa from "../multiHoa.js";
import type * as openai from "../openai.js";
import type * as photos from "../photos.js";
import type * as platform from "../platform.js";
import type * as platformNode from "../platformNode.js";
import type * as properties from "../properties.js";
import type * as resend from "../resend.js";
import type * as streets from "../streets.js";
import type * as templateRender from "../templateRender.js";
import type * as templates from "../templates.js";
import type * as tenancy from "../tenancy.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  aiConfig: typeof aiConfig;
  arcApplicationReview: typeof arcApplicationReview;
  arcApplications: typeof arcApplications;
  arcDocIngest: typeof arcDocIngest;
  arcReferenceDocs: typeof arcReferenceDocs;
  arcReviewSettings: typeof arcReviewSettings;
  chat: typeof chat;
  demoSeed: typeof demoSeed;
  fixPhotos: typeof fixPhotos;
  homeowners: typeof homeowners;
  http: typeof http;
  inspectionBullets: typeof inspectionBullets;
  letterBody: typeof letterBody;
  letterTemplateDocs: typeof letterTemplateDocs;
  letterTemplateIngest: typeof letterTemplateIngest;
  letters: typeof letters;
  "lib/arcReviewJson": typeof lib_arcReviewJson;
  "lib/homeownerAuth": typeof lib_homeownerAuth;
  "lib/homeownerRateLimit": typeof lib_homeownerRateLimit;
  "lib/inspectorNotes": typeof lib_inspectorNotes;
  "lib/letterBulletFewShot": typeof lib_letterBulletFewShot;
  "lib/letterTemplateVariant": typeof lib_letterTemplateVariant;
  "lib/letterTemplateVersions": typeof lib_letterTemplateVersions;
  "lib/letterWorkflow": typeof lib_letterWorkflow;
  "lib/parseDocxText": typeof lib_parseDocxText;
  "lib/platformAuth": typeof lib_platformAuth;
  "lib/propertyStatus": typeof lib_propertyStatus;
  "lib/tenantAuth": typeof lib_tenantAuth;
  members: typeof members;
  membersNode: typeof membersNode;
  multiHoa: typeof multiHoa;
  openai: typeof openai;
  photos: typeof photos;
  platform: typeof platform;
  platformNode: typeof platformNode;
  properties: typeof properties;
  resend: typeof resend;
  streets: typeof streets;
  templateRender: typeof templateRender;
  templates: typeof templates;
  tenancy: typeof tenancy;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
