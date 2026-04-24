import { ConvexProvider } from "convex/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { convex } from "./lib/convexClient";
import Landing from "./pages/Landing";
import AdminGate from "./pages/admin/AdminGate";
import Dashboard from "./pages/admin/Dashboard";
import Settings from "./pages/admin/Settings";
import PropertyReview from "./pages/admin/PropertyReview";
import LetterExport from "./pages/admin/LetterExport";
import InspectorGate from "./pages/inspector/InspectorGate";
import StreetList from "./pages/inspector/StreetList";
import PropertyList from "./pages/inspector/PropertyList";
import PropertyCapture from "./pages/inspector/PropertyCapture";
import HomeownerPortal from "./pages/portal/HomeownerPortal";

const App = () => {
  return (
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/admin" element={<AdminGate />} />
          <Route path="/admin/dashboard" element={<Dashboard />} />
          <Route path="/admin/settings" element={<Settings />} />
          <Route path="/admin/property/:propertyId" element={<PropertyReview />} />
          <Route path="/admin/letter-export" element={<LetterExport />} />
          <Route path="/inspector" element={<InspectorGate />} />
          <Route path="/inspector/streets" element={<StreetList />} />
          <Route path="/inspector/street/:streetId" element={<PropertyList />} />
          <Route path="/inspector/property/:propertyId" element={<PropertyCapture />} />
          <Route path="/portal/:token" element={<HomeownerPortal />} />
        </Routes>
      </BrowserRouter>
    </ConvexProvider>
  );
};

export default App;
