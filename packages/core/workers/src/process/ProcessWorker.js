// @flow

import type {FilePath} from '@parcel/types';
import type {
  WorkerImpl,
  MessageHandler,
  ErrorHandler,
  ExitHandler
} from '../types';
import childProcess, {type ChildProcess} from 'child_process';

export default class ProcessWorker implements WorkerImpl {
  workerPath: FilePath;
  execArgv: Object;
  onMessage: MessageHandler;
  onError: ErrorHandler;
  onExit: ExitHandler;
  child: ChildProcess;
  processQueue: boolean = true;
  sendQueue: Array<any> = [];

  constructor(
    workerPath: FilePath,
    execArgv: Object,
    onMessage: MessageHandler,
    onError: ErrorHandler,
    onExit: ExitHandler
  ) {
    this.workerPath = workerPath;
    this.execArgv = execArgv;
    this.onMessage = onMessage;
    this.onError = onError;
    this.onExit = onExit;
  }

  async start() {
    this.child = childProcess.fork(this.workerPath, process.argv, {
      execArgv: this.execArgv,
      env: process.env,
      cwd: process.cwd()
    });

    // Unref the child and IPC channel so that the workers don't prevent the main process from exiting
    this.child.unref();
    this.child.channel.unref();

    this.child.on('message', (data: string) => {
      this.onMessage(Buffer.from(data, 'base64'));
    });

    this.child.once('exit', this.onExit);
    this.child.on('error', this.onError);
  }

  async stop() {
    this.child.send('die');

    let forceKill = setTimeout(() => this.child.kill('SIGINT'), 500);
    await new Promise(resolve => {
      this.child.once('exit', resolve);
    });

    clearTimeout(forceKill);
  }

  send(data: Buffer) {
    if (!this.processQueue) {
      this.sendQueue.push(data);
      return;
    }

    let result = this.child.send(data.toString('base64'), error => {
      if (error && error instanceof Error) {
        // Ignore this, the workerfarm handles child errors
        return;
      }

      this.processQueue = true;

      if (this.sendQueue.length > 0) {
        let queueCopy = this.sendQueue.slice(0);
        this.sendQueue = [];
        queueCopy.forEach(entry => this.send(entry));
      }
    });

    if (!result || /^win/.test(process.platform)) {
      // Queue is handling too much messages throttle it
      this.processQueue = false;
    }
  }
}