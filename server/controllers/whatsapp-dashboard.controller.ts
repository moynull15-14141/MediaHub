import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { getDashboard } from '../services/whatsapp-dashboard.service';

export const dashboardHandler = async (req: Request, res: Response) => {
  try {
    const dashboard = await getDashboard(getUserId(req));
    res.json(dashboard);
  } catch (err) {
    console.error('WhatsApp dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};
