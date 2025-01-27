import type { Actor, IAction, IActorOutput, IActorTest } from './Actor';
import type { IActorReply, IBusArgs } from './Bus';
import { Bus } from './Bus';

/**
 * A bus that indexes identified actors,
 * so that actions with a corresponding identifier can be published more efficiently.
 *
 * Multiple actors with the same identifier can be subscribed.
 *
 * If actors or actions do not have a valid identifier,
 * then this will fallback to the normal bus behaviour.
 *
 * @see Bus
 *
 * @template A The actor type that can subscribe to the sub.
 * @template I The input type of an actor.
 * @template T The test type of an actor.
 * @template O The output type of an actor.
 */
export class BusIndexed<A extends Actor<I, T, O, any>, I extends IAction, T extends IActorTest, O extends IActorOutput>
  extends Bus<A, I, T, O> {
  protected readonly actorsIndex: Record<string, A[]> = {};
  protected readonly actorIdentifierFields: string[];
  protected readonly actionIdentifierFields: string[];

  /**
   * All enumerable properties from the `args` object are inherited to this bus.
   *
   * @param {IBusIndexedArgs} args Arguments object
   * @param {string} args.name The name for the bus
   * @throws When required arguments are missing.
   */
  public constructor(args: IBusIndexedArgs) {
    super(args);
  }

  public override subscribe(actor: A): void {
    const actorIds = this.getActorIdentifiers(actor) ?? [ '_undefined_' ];
    for (const actorId of actorIds) {
      let actors = this.actorsIndex[actorId];
      if (!actors) {
        actors = this.actorsIndex[actorId] = [];
      }
      actors.push(actor);
      super.subscribe(actor);
    }
  }

  public override unsubscribe(actor: A): boolean {
    const actorIds = this.getActorIdentifiers(actor) ?? [ '_undefined_' ];
    let unsubscribed = false;
    for (const actorId of actorIds) {
      const actors = this.actorsIndex[actorId];
      if (actors) {
        const i = actors.indexOf(actor);
        if (i >= 0) {
          actors.splice(i, 1);
        }
        if (actors.length === 0) {
          delete this.actorsIndex[actorId];
        }
      }
      unsubscribed = unsubscribed || super.unsubscribe(actor);
    }
    return unsubscribed;
  }

  public override publish(action: I): IActorReply<A, I, T, O>[] {
    const actionId = this.getActionIdentifier(action);
    if (actionId) {
      const actors = [ ...this.actorsIndex[actionId] || [], ...this.actorsIndex._undefined_ || [] ];
      return actors.map((actor: A): IActorReply<A, I, T, O> => ({ actor, reply: actor.test(action) }));
    }
    return super.publish(action);
  }

  protected getActorIdentifiers(actor: A): string[] | undefined {
    const identifierValue = <string | string[] | undefined> this.actorIdentifierFields
      .reduce((object: any, field): A => object[field], actor);
    if (!identifierValue) {
      return;
    }
    return Array.isArray(identifierValue) ? identifierValue : [ identifierValue ];
  }

  protected getActionIdentifier(action: I): string {
    return this.actionIdentifierFields.reduce((object: any, field): A => object[field], action);
  }
}

export interface IBusIndexedArgs extends IBusArgs {
  /**
   * Keys to follow down from the actor object.
   * The value at the location following these keys should be a string, a string array, or undefined.
   * If the value is a string array, all strings will be registered as keys that map to the actor.
   */
  actorIdentifierFields: string[];
  /**
   * Keys to follow down from the action object.
   * The value at the location following these keys should be a string or be undefined.
   */
  actionIdentifierFields: string[];
}
