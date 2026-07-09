import { AppRoutes } from "@/AppRoutes";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrowserRouter } from "react-router";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
