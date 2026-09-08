import { ApolloServer } from '@apollo/server';
import { GraphQLError, type ValidationContext, type ASTVisitor } from 'graphql';
import { DESTINATIONS, PRODUCTS, WAREHOUSES, type Order } from './model';
import { RoutingError, RoutingService } from './routing';

export const typeDefs = `#graphql
  enum WarehouseId { BUF RNO }
  enum DestinationId { NYC SFO SEA CHI CLT DEN }
  enum OrderStatus { PENDING ALLOCATED REVIEW CANCELLED }
  type Product { sku: ID!, name: String!, weightLb: Float! }
  type Warehouse { id: WarehouseId!, name: String!, state: String!, region: String! }
  type Destination { city: String!, state: String!, zip: String! }
  type LineItem { sku: ID!, quantity: Int!, product: Product! }
  type StockCheck { sku: ID!, requested: Int!, available: Int! }
  type Candidate {
    warehouseId: WarehouseId!, warehouse: Warehouse!, eligible: Boolean!,
    costCents: Int, transitDays: Int, distanceMiles: Int!, reason: String!, stock: [StockCheck!]!
  }
  type Decision {
    evaluatedAt: String!, selectedWarehouseId: WarehouseId, complete: Boolean!,
    reason: String!, candidates: [Candidate!]!, savingsCents: Int!, policyVersion: String!
  }
  type Order {
    id: ID!, customer: String!, destinationId: DestinationId!, destination: Destination!,
    items: [LineItem!]!, status: OrderStatus!, warehouseId: WarehouseId,
    warehouse: Warehouse, decision: Decision, scenario: String!, createdAt: String!
  }
  type Inventory { warehouseId: WarehouseId!, sku: ID!, onHand: Int!, reserved: Int!, available: Int!, product: Product! }
  type AuditEvent { id: ID!, orderId: ID, action: String!, detail: String!, createdAt: String! }
  type Dashboard { orders: [Order!]!, inventory: [Inventory!]!, events: [AuditEvent!]!, storageMode: String! }
  input LineItemInput { sku: ID!, quantity: Int! }
  input CreateOrderInput { customer: String!, destinationId: DestinationId!, items: [LineItemInput!]! }
  type Query { dashboard: Dashboard!, evaluateOrder(id: ID!): Decision!, warehouses: [Warehouse!]!, products: [Product!]! }
  type Mutation {
    createOrder(input: CreateOrderInput!): Order!
    routeOrder(id: ID!): Order!
    overrideOrder(id: ID!, warehouseId: WarehouseId!, reason: String!): Order!
    cancelOrder(id: ID!): Order!
    resetDemo: Boolean!
    runConcurrencyDemo: String!
  }
`;
export type Context = { service: RoutingService; sessionId: string };

// This small, acyclic schema needs a bounded operation size, not a cost engine.
// Disable fragments in this demo to make the field budget unambiguous.
function operationBudget(context: ValidationContext): ASTVisitor {
  let fields = 0;
  let mutations = 0;
  return {
    Field(node) {
      if (++fields === 201)
        context.reportError(
          new GraphQLError('Query exceeds the 200-field demo limit.', { nodes: node }),
        );
    },
    FragmentDefinition(node) {
      context.reportError(
        new GraphQLError('Fragments are disabled in this bounded demo API.', { nodes: node }),
      );
    },
    OperationDefinition(node) {
      if (node.operation === 'mutation') {
        mutations += node.selectionSet.selections.length;
        if (mutations > 1)
          context.reportError(
            new GraphQLError('Send one mutation field per request.', { nodes: node }),
          );
      }
    },
  };
}
export function createApi() {
  return new ApolloServer<Context>({
    typeDefs,
    validationRules: [operationBudget],
    includeStacktraceInErrorResponses: false,
    introspection: true,
    resolvers: {
      Query: {
        dashboard: (_: unknown, __: unknown, c: Context) => c.service.dashboard(c.sessionId),
        evaluateOrder: (_: unknown, { id }: { id: string }, c: Context) =>
          c.service.preview(c.sessionId, id),
        warehouses: () => WAREHOUSES,
        products: () => PRODUCTS,
      },
      Mutation: {
        createOrder: (_: unknown, { input }: { input: unknown }, c: Context) =>
          c.service.createOrder(c.sessionId, input),
        routeOrder: (_: unknown, { id }: { id: string }, c: Context) =>
          c.service.route(c.sessionId, id),
        overrideOrder: (
          _: unknown,
          args: { id: string; warehouseId: 'BUF' | 'RNO'; reason: string },
          c: Context,
        ) => c.service.route(c.sessionId, args.id, args),
        cancelOrder: (_: unknown, { id }: { id: string }, c: Context) =>
          c.service.cancel(c.sessionId, id),
        resetDemo: (_: unknown, __: unknown, c: Context) => c.service.reset(c.sessionId),
        runConcurrencyDemo: (_: unknown, __: unknown, c: Context) => c.service.race(c.sessionId),
      },
      Order: {
        destination: (order: Order) => DESTINATIONS[order.destinationId],
        warehouse: (order: Order) => WAREHOUSES.find((w) => w.id === order.warehouseId) ?? null,
      },
      Candidate: {
        warehouse: (c: { warehouseId: string }) => WAREHOUSES.find((w) => w.id === c.warehouseId),
      },
      LineItem: { product: (item: { sku: string }) => PRODUCTS.find((p) => p.sku === item.sku) },
      Inventory: { product: (item: { sku: string }) => PRODUCTS.find((p) => p.sku === item.sku) },
    },
    formatError: (formatted, error) => {
      const original = error instanceof GraphQLError ? error.originalError : null;
      if (original instanceof RoutingError)
        return { ...formatted, extensions: { code: original.code } };
      if (formatted.extensions?.code === 'INTERNAL_SERVER_ERROR') {
        console.error('GraphQL resolver failed', error);
        return {
          message: 'The operation could not be completed. Please retry.',
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        };
      }
      return formatted;
    },
  });
}
