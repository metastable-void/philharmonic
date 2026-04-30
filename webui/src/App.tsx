import type { JSX } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import AuditLog from "./pages/AuditLog";
import Dashboard from "./pages/Dashboard";
import InstanceDetail from "./pages/InstanceDetail";
import Instances from "./pages/Instances";
import Login from "./pages/Login";
import TemplateDetail from "./pages/TemplateDetail";
import Templates from "./pages/Templates";
import TenantSettings from "./pages/TenantSettings";

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/templates/:id" element={<TemplateDetail />} />
            <Route path="/instances" element={<Instances />} />
            <Route path="/instances/:id" element={<InstanceDetail />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/settings" element={<TenantSettings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
