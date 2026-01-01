import { BrowserRouter, Routes, Route } from "react-router-dom";
import RequireFeedData from "./RequireFeedData";
import LandingPage from "./LandingPage";
import Feed from "./Feed";
import BillPage from "./BillPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/feed"
          element={
            <RequireFeedData>
              <Feed></Feed>
            </RequireFeedData>
          }
        />
        <Route path="/bill/:billNumber" element={<BillPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
