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
  "esri/request",
  "esri/identity/IdentityManager",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/Slider",
  "esri/widgets/BasemapToggle",
  "esri/widgets/Expand",
  "esri/layers/support/RasterFunction",
  "Application/ApplicationParameters"
], function(calcite, declare, ApplicationBase,
            i18n, itemUtils, domHelper, domConstruct,
            esriRequest, IdentityManager, Evented, watchUtils, promiseUtils, Portal,
            Home, Search, Slider, BasemapToggle, Expand, RasterFunction, ApplicationParameters){

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

        // BASEMAP TOGGLE //
        // https://developers.arcgis.com/javascript/latest/api-reference/esri-Map.html#basemap
        const basemapToggle = new BasemapToggle({
          view: view,
          nextBasemap: "topo"
        });
        view.ui.add(basemapToggle, { position: "top-right", index: 0 });

        // HOME //
        const home = new Home({ view: view });
        view.ui.add(home, { position: "top-left", index: 1 });

        // PANEL TOGGLE //
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

        //
        // RASTER ANALYSIS LAYER //
        //
        const rasterAnalysisLayer = view.map.layers.find(layer => { return (layer.title === "WO Raster Analysis"); });
        rasterAnalysisLayer.load().then(() => {
          // rasterAnalysisLayer

          // INITIAL LAYER OPACITY AND VISIBILITY //
          rasterAnalysisLayer.opacity = 1.0;
          rasterAnalysisLayer.visible = false;

          // https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-Slider.html
          const rasterAnalysisOpacitySlider = new Slider({
            container: 'raster-layer-opacity-slider',
            min: 0.0, max: 1.0,
            values: [rasterAnalysisLayer.opacity],
            snapOnClickEnabled: true,
            visibleElements: { labels: false, rangeLabels: false }
          });
          rasterAnalysisOpacitySlider.watch('values', values => {
            rasterAnalysisLayer.opacity = values[0];
          });

        });

        //
        // PADUS LAYER //
        //
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
            visibleElements: { labels: false, rangeLabels: false }
          });
          padusOpacitySlider.watch('values', values => {
            padusLayer.opacity = values[0];
          });
        });

        //
        // FEDLANDS LAYER //
        //
        const fedlandsLayer = view.map.layers.find(layer => { return (layer.title === "USA Federal Lands"); });
        fedlandsLayer.load().then(() => {

          // INITIAL LAYER OPACITY AND VISIBILITY //
          fedlandsLayer.opacity = 0.0;
          fedlandsLayer.visible = true;

          // https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-Slider.html
          const fedlandsOpacitySlider = new Slider({
            container: 'fedlands-layer-opacity-slider',
            min: 0.0, max: 1.0,
            values: [fedlandsLayer.opacity],
            snapOnClickEnabled: true,
            visibleElements: { labels: false, rangeLabels: false }
          });
          fedlandsOpacitySlider.watch('values', values => {
            fedlandsLayer.opacity = values[0];
          });
        });

        // PARAMETER SLIDERS //
        this.initializeParameterSliders().then(() => {
          // ANALYSIS //
          this.initializeAnalysis(view, rasterAnalysisLayer);

          // RESOLVE //
          resolve();
        });

      });
    },

    /**
     * https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-Slider.html
     *
     */
    initializeParameterSliders: function(){
      return promiseUtils.create((resolve, reject) => {

        // PARAMETERS CONTAINER //
        const parametersContainer = document.getElementById('parameters-container');

        // GET PARAMETER CONFIG //
        esriRequest('./config/parameters.json').then(response => {

          /**
           *  For each parameter:
           *   ...here's some general guidance for creating parameter nodes, labels, sliders, etc...
           */

          //
          // PARAMETER INFOS ARE THE DEFAULT PARAMETERS AUGMENTED WITH UI ELEMENTS //
          //
          this.parameterInfos = response.data.parameters;
          this.parameterInfos.forEach((parameterInfo, parameterInfoIdx) => {

            let classHidden = parameterInfo.hideable ? ' hideable hide' : '';
            const paramNode = domConstruct.create('div', {
              className: 'parameter-node content-row tooltip tooltip-bottom tooltip-multiline' + classHidden,
              'aria-label': parameterInfo.help
            }, parametersContainer);

            // SHOW TOOLTIP ABOVE FOR BOTTOM HALF OF LIST //
            if(parameterInfoIdx > (this.parameterInfos.length / 2)){
              paramNode.classList.remove('tooltip-bottom');
              paramNode.classList.add('tooltip-top');
            }

            const labelNode = domConstruct.create('div', {
              className: 'parameter-name font-size--3 avenir-demi',
              innerHTML: parameterInfo.label
            }, paramNode);
            const sliderNode = domConstruct.create('div', {
              className: 'parameter-slider',
              'data-id': parameterInfo.rasterId,
            }, paramNode);
            const percentNode = domConstruct.create('div', {
              className: 'parameter-percent font-size--3 avenir-demi text-right',
              style: {'padding-right': '6px'}, 
              innerHTML: ''
            }, paramNode);

            // DEFAULT VALUE //
            const defaultValue = parameterInfo.values["GI Center Defaults"];

            // PARAMETER SLIDER //
            const parameterSlider = new Slider({
              container: sliderNode,
              min: 0, max: 100,
              precision: 0,
              snapOnClickEnabled: true,
              visibleElements: { labels: false, rangeLabels: false }
            });
            parameterSlider.watch('values', values => {
              const value = values[0];
              const hasValue = (value > 0);

              labelNode.classList.toggle('btn-disabled', !hasValue);
              //percentNode.innerHTML = hasValue ? `${value}%` : '';

              // CURRENT PARAMETER WEIGHT //
              parameterInfo.weight = value;

              // NOTIFY OF WEIGHT CHANGE //
              this.emit("weight-change", {});
            });

            // SET INITIAL VALUE //
            parameterSlider.values = [defaultValue]; // Doesn't trigger on-weight-change event
            // this.emit("weight-change", {});

            // parameterSlider.values = [0]; // We'll manually select a dropdown item on startup later
			
            // ASSOCIATE SLIDER AND PERCENT NODE WITH PARAMETER //
            parameterInfo.slider = parameterSlider;
            parameterInfo.percentNode = percentNode;

          });

          // TOGGLE HIDEABLE PARAMETER NODES //
          const parameterToggleBtn = document.getElementById('parameter-toggle-btn');
          parameterToggleBtn.addEventListener('click', () => {
            document.querySelectorAll('.hideable').forEach(node => {
              node.classList.toggle('hide');
            });
            parameterToggleBtn.innerHTML = (parameterToggleBtn.innerHTML === 'more') ? 'less' : 'more';
          });

          // RESOLVE //
          resolve();
        });
      });
    },

    /**
     *
     * @param view
     * @param rasterAnalysisLayer
     */
    initializeAnalysis: function(view, rasterAnalysisLayer){

      // WEIGHT CHANGE //
      this.on("weight-change", () => {
        let percentTotal = 0;
        
        // GET WEIGHTED OVERLAY PARAMS //
        const weightedOverlayParams = this.parameterInfos.map(parameterInfo => {
          return { id: parameterInfo.rasterId, weight: parameterInfo.weight };
        });
        console.info('weight-change: ', weightedOverlayParams);

        // Get total of slider weights
        const weightSum = weightedOverlayParams.reduce((total, currentValue) => {
          return total + currentValue.weight;
        }, 0);

        // Figure out each slider's percent of the total
        this.parameterInfos.forEach(parameterInfo => {
          let percent = weightSum === 0 ? 0 : Math.round((parameterInfo.weight / weightSum) * 100);
          percentTotal += percent;
          parameterInfo.percent = percent;
        });
        
        // True up percentages for small discrepancies
        let shortfall = 100 - percentTotal;
        if (weightSum > 0 && shortfall != 0) {
            let adjustEachWeightBy = (shortfall > 0) ? 1 : -1;
            for (let i = 0; i < this.parameterInfos.length & shortfall != 0; i++) {
              let parameterInfo = this.parameterInfos[i];
              // Don't modify a weight that's already zero
              if (parameterInfo.percent != 0) {
                  parameterInfo.percent += adjustEachWeightBy;
                  shortfall -= adjustEachWeightBy;
              }
            }
        }
        
        // ...HERE YOU CAN UPDATE THE PERCENT LABELS... //
        this.parameterInfos.forEach(parameterInfo => {
          console.info('RASTER ID: ', parameterInfo.rasterId, 'WEIGHT: ', parameterInfo.percent);
          
          parameterInfo.percentNode.innerHTML = parameterInfo.percent;
        });
        
        determineApplyButtonState();
      });

      // PRESET SELECT //
      const presetsSelect = document.getElementById('presets-select');
      presetsSelect.addEventListener('change', () => { applyPreset() });

      // RESET BTN //
      const resetBtn = document.getElementById('reset-btn');
      resetBtn.addEventListener('click', () => { resetWeights(); });

      // APPLY BTN //
      const applyBtn = document.getElementById('apply-btn');
      applyBtn.addEventListener('click', () => { doAnalysis(); });

      // NHD INPUT //
      const nhdInput = document.getElementById('nhd-input');
      nhdInput.addEventListener('change', () => { doAnalysis(); });

      // SELECTION COUNT LABEL //
      const selectionCountLabel = document.getElementById('selection-count-label');
      
      /**
       * APPLY CURRENT PRESET
       *  - GI Center Defaults
       *  - Biodiversity Defaults
       */
      const applyPreset = () => {
        this.parameterInfos.forEach(parameterInfo => {
          // parameterInfo.weight = parameterInfo.values[presetsSelect.value];
          parameterInfo.slider.values = [parameterInfo.values[presetsSelect.value]];
        });
// HACK ALERT! DO NOT DO THIS!
        setTimeout(doAnalysis, 500);
      };

      const determineApplyButtonState = () => {
        // Determine whether the right number are selected for a query
        let iSelected = this.parameterInfos.reduce((total, currentSlider) => {
          return currentSlider.weight > 0 ? total + 1 : total;
        }, 0);
        console.log("Selected weights: " + iSelected);
        
        selectionCountLabel.innerText = iSelected + " selected";
				if (iSelected >= 1 && iSelected <= 10) {
            applyBtn.disabled = false;
        } else if (iSelected > 10) {
            applyBtn.disabled = true;
            selectionCountLabel.innerText = "Select no more than 10";
        } else if (iSelected <= 0) {
            applyBtn.disabled = true;
        }
        
      };
      /**
       * RESET ALL WEIGHTS TO ZERO
       */
      const resetWeights = () => {
        this.parameterInfos.forEach(parameterInfo => {
          // parameterInfo.weight = 0;
          parameterInfo.slider.values = [0];
        });
// HACK ALERT! DO NOT DO THIS!
        setTimeout(doAnalysis, 500);
      };

      /**
       *   DO ANALYSIS
       *    - BUILD UP RASTER FUNCTION HERE
       */
      const doAnalysis = () => {
        const RID_DUMMY = 2;
        const PARAM_NHD_NAME = "Raster_2016426_211459_432";
        const PARAM_NHD_VALUE = "$4";
        const RFP_PREFIX_ID = "Raster";
        const RFP_SUFFIX_WEIGHT = "_weight";

        console.info('ANALYSIS LAYER: ', rasterAnalysisLayer);
        console.info('NHD OPTION: ', nhdInput.checked);

        const weightedOverlayParams = this.parameterInfos.map(parameterInfo => {
          return { id: parameterInfo.rasterId, weight: parameterInfo.percent / 100 };
        });
        console.info('WEIGHTED OVERLAY PARAMETERS: ', weightedOverlayParams);

        // If sliders are all at zero, hide the raster analysis layer
        if (this.parameterInfos.some(parameterInfo => {
            return parameterInfo.percent > 0;
         })) {
					 rasterAnalysisLayer.visible = true;
				 } else {
           rasterAnalysisLayer.visible = false;
           return;
         }
        
        // Create parameters
        let params = {}, iParamsUsed = 0;
        for (let iParam = 0; iParam < weightedOverlayParams.length; iParam++) {
            let rasterIdAndWeight = weightedOverlayParams[iParam];
            if (rasterIdAndWeight.weight === 0) continue;

            iParamsUsed++;
            let rastIdParamName = RFP_PREFIX_ID + iParamsUsed;
            let rastWeightParamName = rastIdParamName + RFP_SUFFIX_WEIGHT;
            params[rastIdParamName] = "$" + rasterIdAndWeight.id;
            params[rastWeightParamName] = rasterIdAndWeight.weight;
        }
        
        // Pad out unused parameters with dummy raster ID.
        for (let iRemainder = iParamsUsed + 1; iRemainder < 11; iRemainder++) {
            let rastIdParamName = RFP_PREFIX_ID + iRemainder;
            let rastWeightParamName = rastIdParamName + RFP_SUFFIX_WEIGHT;
            params[rastIdParamName] = "$" + RID_DUMMY; params[rastWeightParamName] = 0;
        }

        params.Colormap = [[1, 199, 255, 226], [2, 148, 213, 180], [3, 96, 172, 133], [4, 45, 130, 87], [5, 0, 89, 44]];
        
        let rfFunctionName = nhdInput.checked ? "WO_GI_Stretch_Mask_NHDFlow" : "WO_GI_Stretch";
        if (nhdInput.checked) {
          params[PARAM_NHD_NAME] = PARAM_NHD_VALUE;
        }

        const rf = new RasterFunction({
          "functionName": rfFunctionName,
          "functionArguments": params
        });

        rasterAnalysisLayer.renderingRule = rf;
      }

      // DO INITIAL ANALYSIS //
      this.emit("weight-change", {});
      setTimeout(doAnalysis, 500);
    }

  });
});
