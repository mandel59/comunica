import type {
  IActionRdfMetadataExtract,
  IActorRdfMetadataExtractOutput,
  IActorRdfMetadataExtractArgs,
} from '@comunica/bus-rdf-metadata-extract';
import { ActorRdfMetadataExtract } from '@comunica/bus-rdf-metadata-extract';
import type { IActorTest, TestResult } from '@comunica/core';
import { passTestVoid } from '@comunica/core';
import type * as RDF from '@rdfjs/types';
import type { UriTemplate } from 'uritemplate';
import { parse as parseUriTemplate } from 'uritemplate';

/**
 * An RDF Metadata Extract Actor that extracts all Hydra controls from the metadata stream.
 */
export class ActorRdfMetadataExtractHydraControls extends ActorRdfMetadataExtract {
  public static readonly HYDRA: string = 'http://www.w3.org/ns/hydra/core#';
  public static readonly LINK_TYPES: string[] = [ 'first', 'next', 'previous', 'last' ];
  protected readonly parsedUriTemplateCache: Record<string, UriTemplate> = {};

  public constructor(args: IActorRdfMetadataExtractArgs) {
    super(args);
  }

  public async test(_action: IActionRdfMetadataExtract): Promise<TestResult<IActorTest>> {
    return passTestVoid();
  }

  /**
   * Collect all Hydra page links from the given Hydra properties object.
   * @param pageUrl The page URL in which the Hydra properties are defined.
   * @param hydraProperties The collected Hydra properties.
   * @return The Hydra links
   */
  public getLinks(pageUrl: string, hydraProperties: Record<string, Record<string, string[]>>):
  Record<string, any> {
    function pathLooseMatch(x: string, y: string): boolean {
      if (x === y) {
        return true;
      }
      if (!x.endsWith('/')) {
        return `${x}/` === y;
      }
      if (!y.endsWith('/')) {
        return x === `${y}/`;
      }
      return false;
    }
    function hashLooseMatch(x: string, y: string): boolean {
      return (x || '#') === (y || '#');
    }
    function urlLooseMatch(x: URL, y: URL): boolean {
      if (
        x.origin !== y.origin ||
        !pathLooseMatch(x.pathname, y.pathname) ||
        !hashLooseMatch(x.hash, y.hash) ||
        x.searchParams.size !== y.searchParams.size
      ) {
        return false;
      }
      for (const k of x.searchParams.keys()) {
        const xVals = x.searchParams.getAll(k);
        const yVals = y.searchParams.getAll(k);
        if (xVals.length !== yVals.length) {
          return false;
        }
        if (xVals.findIndex((v, i) => v !== yVals[i]) >= 0) {
          return false;
        }
      }
      return true;
    }
    return Object.fromEntries(ActorRdfMetadataExtractHydraControls.LINK_TYPES.map((link) => {
      // First check hydra:next (current standard), then fallback to the deprecated hydra:nextPage
      const links = hydraProperties[link] || hydraProperties[`${link}Page`];
      if (!links) {
        return [ link, []];
      }
      const linkTargets = links[pageUrl];
      if (linkTargets && linkTargets.length > 0) {
        return [ link, [ linkTargets[0] ]];
      }
      // The subject of links may not exactly match the pageUrl.
      // Perform a loose match to find the first suitable candidate.
      const pageUrlObj = new URL(pageUrl);
      if (pageUrlObj.protocol === 'http:' || pageUrlObj.protocol === 'https:') {
        const fallbackTargets = Object.entries(links).find(([ s, _o ]) => {
          try {
            return urlLooseMatch(pageUrlObj, new URL(s));
          } catch {
            return false;
          }
        })?.[1];
        if (fallbackTargets && fallbackTargets.length > 0) {
          return [ link, [ fallbackTargets[0] ]];
        }
      }
      return [ link, []];
    }));
  }

  /**
   * Parse a URI template, or retrieve it from a cache.
   * @param {string} template A URI template string.
   * @return {} A parsed URI template object.
   */
  public parseUriTemplateCached(template: string): UriTemplate {
    const cachedUriTemplate: UriTemplate = this.parsedUriTemplateCache[template];
    if (cachedUriTemplate) {
      return cachedUriTemplate;
    }

    return this.parsedUriTemplateCache[template] = parseUriTemplate(template);
  }

  /**
   * Collect all search forms from the given Hydra properties object.
   * @param hydraProperties The collected Hydra properties.
   * @return The search forms.
   */
  public getSearchForms(hydraProperties: Record<string, Record<string, string[]>>): ISearchForms {
    const searchFormData: Record<string, string[]> = hydraProperties.search;
    const searchForms: ISearchForm[] = [];
    if (searchFormData) {
      for (const dataset in searchFormData) {
        for (const searchFormId of searchFormData[dataset]) {
          const searchTemplates = (hydraProperties.template || {})[searchFormId] || [];

          // Parse the template
          if (searchTemplates.length !== 1) {
            throw new Error(`Expected 1 hydra:template for ${searchFormId}`);
          }
          const template: string = searchTemplates[0];
          const searchTemplate: UriTemplate = this.parseUriTemplateCached(template);

          // Parse the template mappings
          const mappings: Record<string, string> = Object
            .fromEntries(((hydraProperties.mapping || {})[searchFormId] || [])
              .map((mapping) => {
                const variable = ((hydraProperties.variable || {})[mapping] || [])[0];
                const property = ((hydraProperties.property || {})[mapping] || [])[0];
                if (!variable) {
                  throw new Error(`Expected a hydra:variable for ${mapping}`);
                }
                if (!property) {
                  throw new Error(`Expected a hydra:property for ${mapping}`);
                }
                return [ property, variable ];
              }));

          // Gets the URL of the Triple Pattern Fragment with the given triple pattern
          const getUri = (entries: Record<string, string>): string => searchTemplate
            .expand(Object.fromEntries(Object.keys(entries).map(key => [ mappings[key], entries[key] ])));

          searchForms.push({ dataset, template, mappings, getUri });
        }
      }
    }
    return { values: searchForms };
  }

  /**
   * Collect all hydra properties from a given metadata stream
   * in a nice convenient nested hash (property / subject / objects).
   * @param {RDF.Stream} metadata
   * @return The collected Hydra properties.
   */
  public getHydraProperties(metadata: RDF.Stream): Promise<Record<string, Record<string, string[]>>> {
    return new Promise((resolve, reject) => {
      metadata.on('error', reject);

      // Collect all hydra properties in a nice convenient nested hash (property / subject / objects).
      const hydraProperties: Record<string, Record<string, string[]>> = {};
      metadata.on('data', (quad) => {
        if (quad.predicate.value.startsWith(ActorRdfMetadataExtractHydraControls.HYDRA)) {
          const property = quad.predicate.value.slice(ActorRdfMetadataExtractHydraControls.HYDRA.length);
          const subjectProperties = hydraProperties[property] || (hydraProperties[property] = {});
          const objects = subjectProperties[quad.subject.value] || (subjectProperties[quad.subject.value] = []);
          objects.push(quad.object.value);
        }
      });

      metadata.on('end', () => resolve(hydraProperties));
    });
  }

  public async run(action: IActionRdfMetadataExtract): Promise<IActorRdfMetadataExtractOutput> {
    const metadata: IActorRdfMetadataExtractOutput['metadata'] = {};
    const hydraProperties = await this.getHydraProperties(action.metadata);
    Object.assign(metadata, this.getLinks(action.url, hydraProperties));
    metadata.searchForms = this.getSearchForms(hydraProperties);
    return { metadata };
  }
}

export interface ISearchForm {
  /**
   * The dataset in which the search form is defined.
   */
  dataset: string;
  /**
   * The URI template containing Hydra variables.
   */
  template: string;
  /**
   * The mappings.
   * With as keys the Hydra properties,
   * and as values the Hydra variables
   */
  mappings: Record<string, string>;

  /**
   * Instantiate a uri based on the given Hydra variable values.
   * @param entries Entries with as keys Hydra properties,
   *                and as values Hydra variable values.
   * @return {string} The instantiated URI
   */
  getUri: (entries: Record<string, string>) => string;
}

export interface ISearchForms {
  /**
   * All available search forms.
   */
  values: ISearchForm[];
}
