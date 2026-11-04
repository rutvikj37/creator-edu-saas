import { createBrowserRouter, RouterProvider } from 'react-router';
import { Providers } from './Providers.jsx';
import { routes } from '../routes/routes.jsx';

const router = createBrowserRouter(routes);

export function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
