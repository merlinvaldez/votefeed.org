import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./LandingPage";
import Feed from "./Feed";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/feed" element={<Feed></Feed>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
