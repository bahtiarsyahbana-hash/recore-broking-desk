/**
 * View registry — every screen the desk can show, in one list.
 *
 * Adding a module means adding it here and to core/navigation.js. Nothing else
 * in the app needs to know it exists.
 */
import { dashboardView } from "./broker/dashboard.view.js";
import { placementsView } from "./broker/placements.view.js";
import { intakeView } from "./broker/intake.view.js";
import { treatyView } from "./broker/treaty.view.js";
import { claimsView } from "./broker/claims.view.js";
import { accountingView } from "./broker/accounting.view.js";
import { reportsView } from "./broker/reports.view.js";
import { registryViews } from "./broker/registry.view.js";

import { cedantProgramsView } from "./cedant/programs.view.js";
import { cedantSubmitView } from "./cedant/submit.view.js";
import { cedantBordereauView } from "./cedant/bordereau.view.js";
import { cedantStatementView } from "./cedant/statement.view.js";

export const allViews = [
  dashboardView,
  intakeView,
  placementsView,
  treatyView,
  claimsView,
  accountingView,
  reportsView,
  // The registry is one page per counterparty category.
  ...registryViews,
  cedantProgramsView,
  cedantSubmitView,
  cedantBordereauView,
  cedantStatementView,
];
