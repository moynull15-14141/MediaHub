import { Request, Response } from 'express';
import { registerUser, verifyUserCredentials, createAuthToken, verifyAuthToken, setUserCookies, findUserById } from '../services/user.service';

export const register = (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = registerUser(email, password);
    const token = createAuthToken(user);
    res.json({ token, user: { id: user.id, email: user.email, createdAt: user.createdAt } });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Registration failed' });
  }
};

export const login = (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = verifyUserCredentials(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = createAuthToken(user);
    res.json({ token, user: { id: user.id, email: user.email, createdAt: user.createdAt } });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Login failed' });
  }
};

export const whoami = (req: Request, res: Response) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const token = authorization.split(' ')[1];
  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = findUserById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  res.json({ user: { id: user.id, email: user.email, createdAt: user.createdAt, cookieUploadedAt: user.cookieUploadedAt } });
};

export const uploadCookies = (req: Request, res: Response) => {
  try {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }
    const token = authorization.split(' ')[1];
    const payload = verifyAuthToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const rawCookieData = req.body.cookies;
    if (!rawCookieData || typeof rawCookieData !== 'string') {
      return res.status(400).json({ error: 'Cookie data is required' });
    }

    setUserCookies(payload.sub, rawCookieData);
    res.json({ status: 'ok', message: 'Cookies uploaded successfully' });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Cookie upload failed' });
  }
};