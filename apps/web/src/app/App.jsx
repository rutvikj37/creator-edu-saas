import { createBrowserRouter, RouterProvider } from 'react-router';
import { Providers } from './Providers.jsx';
import { buildRoutes } from '../routes/routes.jsx';

const router = createBrowserRouter(buildRoutes());

export function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
