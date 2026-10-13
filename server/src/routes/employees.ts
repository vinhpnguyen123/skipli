import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createEmployeeSchema,
  employeeIdBody,
  employeeIdParams,
  updateEmployeeSchema,
} from '../schemas/employees.js';
import {
  createEmployee,
  deleteEmployee,
  getEmployee,
  listEmployees,
  resendInvite,
  updateEmployee,
} from '../services/employees.js';

const owner = [requireAuth, requireRole('owner')];

// Mounted at /api. Spec endpoint names (CreateEmployee, GetEmployee, DeleteEmployee) stay exactly as written.
export const employeesRouter = Router();

employeesRouter.post(
  '/CreateEmployee',
  ...owner,
  validate({ body: createEmployeeSchema }),
  async (req, res) => {
    res.json({ success: true, ...(await createEmployee(req.user!, req.body)) });
  },
);

// Owner, or the employee themselves (others get 404).
employeesRouter.post(
  '/GetEmployee',
  requireAuth,
  validate({ body: employeeIdBody }),
  async (req, res) => {
    res.json(await getEmployee(req.user!, req.body.employeeId));
  },
);

employeesRouter.post(
  '/DeleteEmployee',
  ...owner,
  validate({ body: employeeIdBody }),
  async (req, res) => {
    await deleteEmployee(req.user!, req.body.employeeId);
    res.json({ success: true });
  },
);

employeesRouter.get('/employees', ...owner, async (_req, res) => {
  res.json({ employees: await listEmployees() });
});

employeesRouter.patch(
  '/employees/:id',
  ...owner,
  validate({ params: employeeIdParams, body: updateEmployeeSchema }),
  async (req, res) => {
    res.json(await updateEmployee(req.user!, req.params.id as string, req.body));
  },
);

employeesRouter.post(
  '/employee/resend-invite',
  ...owner,
  validate({ body: employeeIdBody }),
  async (req, res) => {
    res.json({ success: true, ...(await resendInvite(req.user!, req.body.employeeId)) });
  },
);
