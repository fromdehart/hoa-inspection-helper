import { BrowserRouter, Routes, Route } from "react-router-dom";
import RoleGuard from "./components/RoleGuard";
import Landing from "./pages/Landing";
import AdminGate from "./pages/admin/AdminGate";
import Dashboard from "./pages/admin/Dashboard";
import Settings from "./pages/admin/Settings";
import Members from "./pages/admin/Members";
import PropertyReview from "./pages/admin/PropertyReview";
import LetterExport from "./pages/admin/LetterExport";
import InspectorGate from "./pages/inspector/InspectorGate";
import StreetList from "./pages/inspector/StreetList";
import PropertyList from "./pages/inspector/PropertyList";
import PropertyCapture from "./pages/inspector/PropertyCapture";
import SignInPage from "./pages/auth/SignInPage";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
          <Route path="/" element={<Landing />} />
          {/* Clerk MFA / email steps use /sign-in/factor-one, etc. — splat keeps them on this page */}
          <Route path="/sign-in/*" element={<SignInPage />} />
          <Route path="/admin" element={<AdminGate />} />
          <Route
            path="/admin/dashboard"
            element={
              <RoleGuard allow="admin">
                <Dashboard />
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
          <Route
            path="/admin/members"
            element={
              <RoleGuard allow="admin">
                <Members />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/property/:propertyId"
            element={
              <RoleGuard allow="admin">
                <PropertyReview />
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
      </Routes>
    </BrowserRouter>
  );
};

export default App;
