import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sourceSystemsRouter from "./source-systems";
import endpointsRouter from "./endpoints";
import parametersRouter from "./parameters";
import runsRouter from "./runs";
import schedulerRouter from "./scheduler";
import monitorRouter from "./monitor";
import incontactRouter from "./incontact";
import bqRouter from "./bq";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sourceSystemsRouter);
router.use(endpointsRouter);
router.use(parametersRouter);
router.use(runsRouter);
router.use(schedulerRouter);
router.use(monitorRouter);
router.use(incontactRouter);
router.use(bqRouter);

export default router;
