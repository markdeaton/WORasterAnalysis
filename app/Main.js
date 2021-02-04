/*
  Copyright 2020 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

define([
  "calcite",
  "dojo/_base/declare",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/dom-construct",
  "esri/identity/IdentityManager",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/layers/ImageryLayer",
  "esri/layers/support/RasterFunction",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/Slider",
  "esri/widgets/Expand",
  "Application/ApplicationParameters"
], function(calcite, declare, ApplicationBase,
            i18n, itemUtils, domHelper, domConstruct,
            IdentityManager, Evented, watchUtils, promiseUtils, Portal,
            ImageryLayer, RasterFunction,
            Home, Search, Slider, Expand,
            ApplicationParameters){

  return declare([Evented], {

    /**
     *
     */
    constructor: function(){
      // BASE //
      this.base = null;
      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function(base){
      if(!base){
        console.error("ApplicationBase is not defined");
        return;
      }
      this.base = base;

      const webMapItems = this.base.results.webMapItems;
      const webSceneItems = this.base.results.webSceneItems;
      const validItems = webMapItems.concat(webSceneItems);
      const firstItem = (validItems && validItems.length) ? validItems[0].value : null;
      if(!firstItem){
        console.error("Could not load an item to display");
        return;
      }

      // TITLE //
      this.base.config.title = (this.base.config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(this.base.config.title);
      document.querySelectorAll('.app-title').forEach(node => node.innerHTML = this.base.config.title);
      // DESCRIPTION //
      if(firstItem.description && firstItem.description.length){
        document.querySelectorAll('.app-description').forEach(node => node.innerHTML = firstItem.description);
      }

      const viewProperties = itemUtils.getConfigViewProperties(this.base.config);
      viewProperties.container = "view-node";
      viewProperties.constraints = { snapToZoom: false };

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: firstItem, appProxies: appProxies }).then(map => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then(view => {
          view.when(() => {
            this.viewReady(firstItem, view).then(() => {
              view.container.classList.remove("loading");
            });
          });
        });
      });
    },

    /**
     *
     * @param item
     * @param view
     */
    viewReady: function(item, view){
      return promiseUtils.create((resolve, reject) => {

        // STARTUP DIALOG //
        this.initializeStartupDialog();

        // VIEW LOADING //
        this.initializeViewLoading(view);

        // SEARCH //
        const search = new Search({ view: view, searchTerm: this.base.config.search || "" });
        const searchExpand = new Expand({
          view: view,
          content: search,
          expanded: true,
          expandIconClass: "esri-icon-search",
          expandTooltip: "Search"
        });
        view.ui.add(searchExpand, { position: "top-left", index: 0 });

        // HOME //
        const home = new Home({ view: view });
        view.ui.add(home, { position: "top-left", index: 1 });

        this.initializePanelToggle();

        // APPLICATION READY //
        this.applicationReady(view).then(resolve).catch(reject);

      });
    },
      
    /**
     *
     * @param view
     */
    initializeViewLoading: function(view){

      // LOADING //
      const updating_node = domConstruct.create("div", { className: "view-loading-node loader" });
      domConstruct.create("div", { className: "loader-bars" }, updating_node);
      domConstruct.create("div", { className: "loader-text font-size--3 text-white", innerHTML: "Updating..." }, updating_node);
      view.ui.add(updating_node, "bottom-right");
      watchUtils.init(view, "updating", (updating) => {
        updating_node.classList.toggle("is-active", updating);
      });

    },

    /**
     *
     */
    initializeStartupDialog: function(){

      // APP NAME //
      const pathParts = location.pathname.split('/');
      const appName = `show-startup-${pathParts[pathParts.length - 2]}`;

      // STARTUP DIALOG //
      const showStartup = localStorage.getItem(appName) || 'show';
      if(showStartup === 'show'){
        calcite.bus.emit('modal:open', { id: 'app-details-dialog' });
      }

      // HIDE STARTUP DIALOG //
      const hideStartupInput = document.getElementById('hide-startup-input');
      hideStartupInput.checked = (showStartup === 'hide');
      hideStartupInput.addEventListener('change', () => {
        localStorage.setItem(appName, hideStartupInput.checked ? 'hide' : 'show');
      });

    },

    /**
     *
     */
    initializePanelToggle: function(){
      const leftContainer = document.getElementById('left-container');
      const panelToggleBtn = document.getElementById('panel-toggle-btn');
      panelToggleBtn.addEventListener('click', evt => {
        leftContainer.classList.toggle('hide');
      });
    },

    /**
     * APPLICATION READY
     *
     * @param view
     */
    applicationReady: function(view){
      return promiseUtils.create((resolve, reject) => {

        // RASTER ANALYSIS LAYER //
        const rasterAnalysisLayer = view.map.layers.find(layer => { return (layer.title === "WO Raster Analysis"); });
        rasterAnalysisLayer.load().then(() => {
          // rasterAnalysisLayer

          // INITIAL LAYER OPACITY AND VISIBILITY //
          rasterAnalysisLayer.opacity = 1.0;
          rasterAnalysisLayer.visible = true;

          // https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-Slider.html
          const rasterAnalysisOpacitySlider = new Slider({
            container: 'raster-layer-opacity-slider',
            min: 0.0, max: 1.0,
            values: [rasterAnalysisLayer.opacity],
            snapOnClickEnabled: true,
            visibleElements: {
              labels: false,
              rangeLabels: false
            }
          });
          rasterAnalysisOpacitySlider.watch('values', values => {
            rasterAnalysisLayer.opacity = values[0];
          });

        });


        // PADUS LAYER //
        const padusLayer = view.map.layers.find(layer => { return (layer.title === "GAPStatus1And2"); });
        padusLayer.load().then(() => {

          // INITIAL LAYER OPACITY AND VISIBILITY //
          padusLayer.opacity = 0.0;
          padusLayer.visible = true;

          // https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-Slider.html
          const padusOpacitySlider = new Slider({
            container: 'padus-layer-opacity-slider',
            min: 0.0, max: 1.0,
            values: [padusLayer.opacity],
            snapOnClickEnabled: true,
            visibleElements: {
              labels: false,
              rangeLabels: false
            }
          });
          padusOpacitySlider.watch('values', values => {
            padusLayer.opacity = values[0];
          });
        });


        this.initializeSliders(view);
        this.initializeAnalysis(view, rasterAnalysisLayer);

        resolve();
      });
    },

    /**
     * https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-Slider.html
     *
     * @param view
     */
    initializeSliders: function(view){

      // PARAMETERS CONTAINER //
      const parametersContainer = document.getElementById('parameters-container');

      // PARAMETER VALUES //
      this.parameters = {};

      /**
       *  For each parameter:
       *   ...here's some general guidance for creating parameter nodes, labels, and sliders.
       */

      const paramNode = domConstruct.create('div', {
        className: 'parameter-node content-row tooltip tool-top tooltip-multiline',
        'aria-label': 'parameter details here'
      }, parametersContainer);

      const nameNode = domConstruct.create('div', {
        className: 'font-size--3 column-3',
        innerHTML: 'parameter name here'
      }, paramNode);
      const sliderNode = domConstruct.create('div', {}, paramNode);
      const labelNode = domConstruct.create('div', {
        className: 'font-size--3 text-right column-2',
        innerHTML: ''
      }, paramNode);

      const parameterSlider = new Slider({
        container: sliderNode,
        min: 0, max: 100,
        precision: 0,
        values: [0],
        snapOnClickEnabled: true,
        visibleElements: { labels: false, rangeLabels: false }
      });
      parameterSlider.watch('values', values => {
        const value = values[0];
        labelNode.innerHTML = (value > 0) ? `${value} %` : '';
        this.parameters['paramName1'] = value;
      });

      // INITIAL PARAM VALUE //
      this.parameters['paramName1'] = parameterSlider.values[0];

    },

    /**
     *
     * @param view
     * @param rasterAnalysisLayer
     */
    initializeAnalysis: function(view, rasterAnalysisLayer){

      // RESET //
      const resetBtn = document.getElementById('reset-btn');
      resetBtn.addEventListener('click', () => {
        console.info('RESET: ');
        doReset();
      });

      // APPLY //
      const applyBtn = document.getElementById('apply-btn');
      applyBtn.addEventListener('click', () => {
        console.info('APPLY: ');
        doAnalysis();
      });

      /**
       * RESET
       */
      const doReset = () => {
        console.info('RESET: ');

      };

      /**
       *   DO ANALYSIS
       */
      const doAnalysis = () => {
        console.info('ANALYSIS: ', this.parameters, rasterAnalysisLayer);


      }
    }

  });
});
