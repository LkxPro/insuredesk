import { BrowserRouter } from "react-router";
import { AppRoutes } from "@/AppRoutes";
import { ToastHost } from "@/components/ToastHost";
import { AuthProvider } from "@/contexts/AuthContext";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <ToastHost />
      </AuthProvider>
    </BrowserRouter>
  );
}
