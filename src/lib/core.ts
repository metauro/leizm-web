import { ServerRequest, ServerResponse } from 'http';
import { Context } from './context';
import {
  Middleware, MiddlewareHandle, ErrorReason, NextFunction, PathRegExp, ContextConstructor, RegExpOptions,
} from './define';
import {
  testRoutePath, parseRoutePath, getRouteParams, isMiddlewareErrorHandle, execMiddlewareHandle, getRouteMatchPath,
} from './utils';

export class Core {

  /** 中间件堆栈 */
  protected readonly stack: Middleware[] = [];
  /** Context对象构造函数 */
  protected contextConstructor: ContextConstructor = Context;
  /** 解析路由选项 */
  protected readonly routeOptions: RegExpOptions = {
    sensitive: true,
    strict: true,
    end: true,
    delimiter: '/',
  };
  /** 父中间件的路由规则 */
  protected parentRoutePath: RegExp = null;

  /**
   * 创建Context对象
   *
   * @param req 原始ServerRequest对象
   * @param res 原始ServerResponse对象
   */
  protected createContext(req: ServerRequest, res: ServerResponse) {
    return new this.contextConstructor().init(req, res);
  }

  /**
   * 解析路由规则
   *
   * @param isPrefix 是否为前缀模式
   * @param route 路由规则
   */
  protected parseRoutePath(isPrefix: boolean, route: string | RegExp) {
    return parseRoutePath(route, {
      ...this.routeOptions,
      end: !isPrefix,
    });
  }

  /**
   * 生成中间件
   */
  public toMiddleware() {
    const router = this;
    return function (ctx: Context) {
      router.handleRequestByContext(ctx, function (err) {
        ctx.next(err);
      });
    };
  }

  /**
   * 注册中间件
   *
   * @param route 路由规则
   * @param handles 中间件对象或处理函数
   */
  public use(route: string | RegExp, ...handles: Array<MiddlewareHandle | Core>) {
    this.useMiddleware(true, route, ...handles.map(item => {
      if (item instanceof Core) {
        item.parentRoutePath = this.parseRoutePath(true, route);
        return item.toMiddleware();
      }
      return item;
    }));
  }

  /**
   * 注册中间件
   *
   * @param isPrefix 是否为前缀模式
   * @param route 路由规则
   * @param handles 中间件对象或处理函数
   */
  protected useMiddleware(isPrefix: boolean, route: string | RegExp, ...handles: MiddlewareHandle[]) {
    for (const handle of handles) {
      this.stack.push({
        route: this.parseRoutePath(isPrefix, route),
        handle,
        handleError: isMiddlewareErrorHandle(handle),
      });
    }
  }

  /**
   * 通过Context对象处理请求
   *
   * @param ctx Context对象
   * @param done 未处理请求回调函数
   */
  protected handleRequestByContext(ctx: Context, done: (err?: ErrorReason) => void) {
    let index = 0;
    const prePathPrefix = ctx.request.pathPrefix;
    const pathPrefix = getRouteMatchPath(ctx.request.path, this.parentRoutePath as PathRegExp);
    ctx.request.reset(pathPrefix, {});

    type GetMiddlewareHandle = () => (void | Middleware);

    const getNextHandle: GetMiddlewareHandle = () => {
      const handle = this.stack[index++];
      if (!handle) return;
      if (handle.handleError) return getNextHandle();
      return handle;
    };

    const getNextErrorHandle: GetMiddlewareHandle = () => {
      const handle = this.stack[index++];
      if (!handle) return;
      if (!handle.handleError) return getNextErrorHandle();
      return handle;
    };

    const next: NextFunction = (err) => {
      const handle = err ? getNextErrorHandle() : getNextHandle();
      err = err || null;
      if (!handle) {
        ctx.popNextHandle();
        ctx.request.reset(prePathPrefix, {});
        return done(err || null);
      }
      if (!testRoutePath(ctx.request.path, handle.route)) {
        return next(err);
      }
      ctx.request.params = getRouteParams(ctx.request.path, handle.route as PathRegExp);
      execMiddlewareHandle(handle.handle, ctx, err, next);
    };

    ctx.pushNextHandle(next);
    ctx.next();
  }

  /**
   * 通过原始ServerRequest和ServerResponse对象处理请求
   * @param req 原始ServerRequest对象
   * @param res 原始ServerResponse对象
   * @param done 未处理请求回调函数
   */
  protected handleRequestByRequestResponse(req: ServerRequest, res: ServerResponse, done: (err?: ErrorReason) => void) {
    this.handleRequestByContext(this.createContext(req, res), done);
  }

}
