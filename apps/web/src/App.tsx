import { BrowserRouter } from "react-router";
import { AppRoutes } from "@/AppRoutes";
import { AuthProvider } from "@/contexts/AuthContext";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
