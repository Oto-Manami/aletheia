/**
 * 渡した処理を、呼ばれた順に 1 つずつ動かす。前の処理が失敗しても、次は動かす。
 * 承認（データベースへの反映と、その後のファイルの移動）を 1 件ずつ終わらせてから次へ進むために使う
 */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
