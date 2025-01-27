import { ActorFunctionFactoryTermDatatype } from '@comunica/actor-function-factory-term-datatype';
import { runFuncTestTable } from '@comunica/bus-function-factory/test/util';
import { Notation } from '@comunica/utils-expression-evaluator/test/util/TestTable';
import { ActorFunctionFactoryTermNow } from '../lib';

describe('We should respect the now01 spec', () => {
  runFuncTestTable({
    registeredActors: [
      args => new ActorFunctionFactoryTermNow(args),
      args => new ActorFunctionFactoryTermDatatype(args),
    ],
    arity: 1,
    operation: 'DATATYPE',
    notation: Notation.Function,
    testTable: `
      'NOW()' = http://www.w3.org/2001/XMLSchema#dateTime
    `,
  });
});

/**
 * RESULTS: now01.srx
 *
 * <?xml version="1.0" encoding="utf-8"?>
 * <sparql xmlns="http://www.w3.org/2005/sparql-results#">
 * <head/>
 * <boolean>true</boolean>
 * </sparql>
 */
