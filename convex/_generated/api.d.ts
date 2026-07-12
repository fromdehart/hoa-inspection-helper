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
import type * as caseWorkflows from "../caseWorkflows.js";
import type * as cases from "../cases.js";
import type * as chat from "../chat.js";
import type * as company from "../company.js";
import type * as companyAdmin from "../companyAdmin.js";
import type * as copilot from "../copilot.js";
import type * as crons from "../crons.js";
import type * as demoSeed from "../demoSeed.js";
import type * as emailIntake from "../emailIntake.js";
import type * as fines from "../fines.js";
import type * as fixPhotos from "../fixPhotos.js";
import type * as hearings from "../hearings.js";
import type * as homeowners from "../homeowners.js";
import type * as http from "../http.js";
import type * as inspectionBullets from "../inspectionBullets.js";
import type * as letterBody from "../letterBody.js";
import type * as letterTemplateDocs from "../letterTemplateDocs.js";
import type * as letterTemplateIngest from "../letterTemplateIngest.js";
import type * as letters from "../letters.js";
import type * as lib_arcReviewJson from "../lib/arcReviewJson.js";
import type * as lib_caseEvents from "../lib/caseEvents.js";
import type * as lib_caseGates from "../lib/caseGates.js";
import type * as lib_caseValidators from "../lib/caseValidators.js";
import type * as lib_companyAuth from "../lib/companyAuth.js";
import type * as lib_companyRateLimit from "../lib/companyRateLimit.js";
import type * as lib_copilotFormat from "../lib/copilotFormat.js";
import type * as lib_defaultWorkflows from "../lib/defaultWorkflows.js";
import type * as lib_featureFlags from "../lib/featureFlags.js";
import type * as lib_homeownerAuth from "../lib/homeownerAuth.js";
import type * as lib_homeownerRateLimit from "../lib/homeownerRateLimit.js";
import type * as lib_inspectorNotes from "../lib/inspectorNotes.js";
import type * as lib_letterBulletFewShot from "../lib/letterBulletFewShot.js";
import type * as lib_letterTemplateVariant from "../lib/letterTemplateVariant.js";
import type * as lib_letterTemplateVersions from "../lib/letterTemplateVersions.js";
import type * as lib_letterWorkflow from "../lib/letterWorkflow.js";
import type * as lib_llmProviders from "../lib/llmProviders.js";
import type * as lib_parseDocxText from "../lib/parseDocxText.js";
import type * as lib_platformAuth from "../lib/platformAuth.js";
import type * as lib_propertyStatus from "../lib/propertyStatus.js";
import type * as lib_propertyStatusRollup from "../lib/propertyStatusRollup.js";
import type * as lib_stewardAutonomy from "../lib/stewardAutonomy.js";
import type * as lib_tenantAuth from "../lib/tenantAuth.js";
import type * as llm from "../llm.js";
import type * as members from "../members.js";
import type * as membersNode from "../membersNode.js";
import type * as migrations_backfillCases from "../migrations/backfillCases.js";
import type * as multiHoa from "../multiHoa.js";
import type * as notices from "../notices.js";
import type * as openai from "../openai.js";
import type * as photos from "../photos.js";
import type * as platform from "../platform.js";
import type * as platformNode from "../platformNode.js";
import type * as portfolio from "../portfolio.js";
import type * as properties from "../properties.js";
import type * as resend from "../resend.js";
import type * as steward from "../steward.js";
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
  caseWorkflows: typeof caseWorkflows;
  cases: typeof cases;
  chat: typeof chat;
  company: typeof company;
  companyAdmin: typeof companyAdmin;
  copilot: typeof copilot;
  crons: typeof crons;
  demoSeed: typeof demoSeed;
  emailIntake: typeof emailIntake;
  fines: typeof fines;
  fixPhotos: typeof fixPhotos;
  hearings: typeof hearings;
  homeowners: typeof homeowners;
  http: typeof http;
  inspectionBullets: typeof inspectionBullets;
  letterBody: typeof letterBody;
  letterTemplateDocs: typeof letterTemplateDocs;
  letterTemplateIngest: typeof letterTemplateIngest;
  letters: typeof letters;
  "lib/arcReviewJson": typeof lib_arcReviewJson;
  "lib/caseEvents": typeof lib_caseEvents;
  "lib/caseGates": typeof lib_caseGates;
  "lib/caseValidators": typeof lib_caseValidators;
  "lib/companyAuth": typeof lib_companyAuth;
  "lib/companyRateLimit": typeof lib_companyRateLimit;
  "lib/copilotFormat": typeof lib_copilotFormat;
  "lib/defaultWorkflows": typeof lib_defaultWorkflows;
  "lib/featureFlags": typeof lib_featureFlags;
  "lib/homeownerAuth": typeof lib_homeownerAuth;
  "lib/homeownerRateLimit": typeof lib_homeownerRateLimit;
  "lib/inspectorNotes": typeof lib_inspectorNotes;
  "lib/letterBulletFewShot": typeof lib_letterBulletFewShot;
  "lib/letterTemplateVariant": typeof lib_letterTemplateVariant;
  "lib/letterTemplateVersions": typeof lib_letterTemplateVersions;
  "lib/letterWorkflow": typeof lib_letterWorkflow;
  "lib/llmProviders": typeof lib_llmProviders;
  "lib/parseDocxText": typeof lib_parseDocxText;
  "lib/platformAuth": typeof lib_platformAuth;
  "lib/propertyStatus": typeof lib_propertyStatus;
  "lib/propertyStatusRollup": typeof lib_propertyStatusRollup;
  "lib/stewardAutonomy": typeof lib_stewardAutonomy;
  "lib/tenantAuth": typeof lib_tenantAuth;
  llm: typeof llm;
  members: typeof members;
  membersNode: typeof membersNode;
  "migrations/backfillCases": typeof migrations_backfillCases;
  multiHoa: typeof multiHoa;
  notices: typeof notices;
  openai: typeof openai;
  photos: typeof photos;
  platform: typeof platform;
  platformNode: typeof platformNode;
  portfolio: typeof portfolio;
  properties: typeof properties;
  resend: typeof resend;
  steward: typeof steward;
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
