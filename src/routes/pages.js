import { Router } from 'express';
import { getLadder, getFixturesView, getBracket, getConfirmedQualifiers } from '../repo.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const ladder = await getLadder();
    res.render('ladder', { title: 'Ladder', active: 'ladder', ladder });
  } catch (err) {
    next(err);
  }
});

router.get('/fixtures', async (req, res, next) => {
  try {
    const groups = await getFixturesView();
    res.render('fixtures', { title: 'Fixtures', active: 'fixtures', groups });
  } catch (err) {
    next(err);
  }
});

router.get('/bracket', async (req, res, next) => {
  try {
    const [bracket, { qualified, possible }] = await Promise.all([
      getBracket(),
      getConfirmedQualifiers(),
    ]);
    res.render('bracket', { title: 'Bracket', active: 'bracket', ...bracket, qualified, possible });
  } catch (err) {
    next(err);
  }
});

export default router;
