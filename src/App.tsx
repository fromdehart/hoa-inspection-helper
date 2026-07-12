import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import RoleGuard from "./components/RoleGuard";
import SyncStatusBanner from "./components/SyncStatusBanner";
import { startSyncManager } from "./offline/syncManager";
import { initNativeShell } from "./native/bootstrap";
import Landing from "./pages/Landing";
import AdminGate from "./pages/admin/AdminGate";
import Properties from "./pages/admin/Properties";
import Walkthrough from "./pages/admin/Walkthrough";
import Desk from "./pages/admin/Desk";
import Settings from "./pages/admin/Settings";
import PropertyReview from "./pages/admin/PropertyReview";
import CaseDetailPage from "./pages/admin/CaseDetailPage";
import LetterExport from "./pages/admin/LetterExport";
import CaseQueue from "./pages/admin/CaseQueue";
import BoardGate from "./pages/board/BoardGate";
import BoardCases from "./pages/board/BoardCases";
import PortfolioDashboard from "./pages/portfolio/PortfolioDashboard";
import InspectorGate from "./pages/inspector/InspectorGate";
import StreetList from "./pages/inspector/StreetList";
import PropertyList from "./pages/inspector/PropertyList";
import PropertyCapture from "./pages/inspector/PropertyCapture";
import SignInPage from "./pages/auth/SignInPage";
import RoleSignInLanding from "./pages/RoleSignInLanding";
import PlatformGate from "./pages/platform/PlatformGate";
import PlatformHoaList from "./pages/platform/PlatformHoaList";
import PlatformHoaDetail from "./pages/platform/PlatformHoaDetail";
import PlatformCompanies from "./pages/platform/PlatformCompanies";
import { MembershipDisplayNameSync } from "./components/MembershipDisplayNameSync";
import HomeownerGuard from "./components/HomeownerGuard";
import ClaimProperty from "./pages/portal/ClaimProperty";
import HomeownerPortal from "./pages/portal/HomeownerPortal";
import HomeLayout from "./pages/home/HomeLayout";
import HomeDashboard from "./pages/home/HomeDashboard";
import InspectionFindings from "./pages/home/InspectionFindings";
import MyCases from "./pages/home/MyCases";
import FixPhotos from "./pages/home/FixPhotos";
import RulesLibrary from "./pages/home/RulesLibrary";
import Chat from "./pages/home/Chat";
import ArcRequest from "./pages/home/ArcRequest";
import NotFound from "./pages/NotFound";

const App = () => {
  useEffect(() => {
    // Native shell chrome + deep-link routing (no-op on web).
    initNativeShell();
    // Start the offline sync engine (network listeners + periodic outbox drain).
    startSyncManager();
  }, []);

  return (
    <>
      <MembershipDisplayNameSync />
      <SyncStatusBanner />
      <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<RoleSignInLanding />} />
          {/* Clerk MFA / email steps use /sign-in/factor-one, etc. — splat keeps them on this page */}
          <Route path="/sign-in/*" element={<SignInPage />} />
          <Route path="/platform" element={<PlatformGate />} />
          <Route path="/platform/hoas" element={<PlatformHoaList />} />
          <Route path="/platform/hoa/:hoaId" element={<PlatformHoaDetail />} />
          <Route path="/platform/companies" element={<PlatformCompanies />} />
          <Route path="/admin" element={<AdminGate />} />
          <Route
            path="/admin/properties"
            element={
              <RoleGuard allow="admin">
                <Properties />
              </RoleGuard>
            }
          />
          {/* Legacy dashboard URL — bookmarks and stale links land on Properties */}
          <Route path="/admin/dashboard" element={<Navigate to="/admin/properties" replace />} />
          <Route
            path="/admin/desk"
            element={
              <RoleGuard allow={["admin", "board"]}>
                <Desk />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/walkthrough"
            element={
              <RoleGuard allow="admin">
                <Walkthrough />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <RoleGuard allow="admin">
                <Settings />
              </RoleGuard>
            }
          />
          {/* Team management now lives in Settings */}
          <Route path="/admin/members" element={<Navigate to="/admin/settings" replace />} />
          <Route
            path="/admin/property/:propertyId"
            element={
              <RoleGuard allow="admin">
                <PropertyReview />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/property/:propertyId/case/:caseId"
            element={
              <RoleGuard allow="admin">
                <CaseDetailPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/letter-export"
            element={
              <RoleGuard allow="admin">
                <LetterExport />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/cases"
            element={
              <RoleGuard allow="admin">
                <CaseQueue />
              </RoleGuard>
            }
          />
          {/* Homeowner portal: emailed token link → claim → authenticated /home */}
          <Route path="/portal/:token" element={<ClaimProperty />} />
          <Route path="/portal/:token/guest" element={<HomeownerPortal />} />
          <Route
            path="/home"
            element={
              <HomeownerGuard>
                <HomeLayout />
              </HomeownerGuard>
            }
          >
            <Route index element={<HomeDashboard />} />
            <Route path="inspection" element={<InspectionFindings />} />
            <Route path="cases" element={<MyCases />} />
            <Route path="fix-photos" element={<FixPhotos />} />
            <Route path="rules" element={<RulesLibrary />} />
            <Route path="chat" element={<Chat />} />
            <Route path="request" element={<ArcRequest />} />
          </Route>

          {/* Management company: portfolio command center (guards itself) */}
          <Route path="/portfolio" element={<PortfolioDashboard />} />

          {/* Board: read-only case oversight */}
          <Route path="/board" element={<BoardGate />} />
          <Route
            path="/board/cases"
            element={
              <RoleGuard allow={["board", "admin"]}>
                <BoardCases />
              </RoleGuard>
            }
          />

          <Route path="/inspector" element={<InspectorGate />} />
          <Route
            path="/inspector/streets"
            element={
              <RoleGuard allow={["inspector", "admin"]}>
                <StreetList />
              </RoleGuard>
            }
          />
          <Route
            path="/inspector/street/:streetId"
            element={
              <RoleGuard allow={["inspector", "admin"]}>
                <PropertyList />
              </RoleGuard>
            }
          />
          <Route
            path="/inspector/property/:propertyId"
            element={
              <RoleGuard allow={["inspector", "admin"]}>
                <PropertyCapture />
              </RoleGuard>
            }
          />
          <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

export default App;
